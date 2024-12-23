import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import type { Secp256k1Keypair } from "@mysten/sui/keypairs/secp256k1";
import {
  compoundReserveInterest,
  LENDING_MARKET_ID,
  LENDING_MARKET_TYPE,
  parseLendingMarket,
  parseObligation,
  refreshObligation,
  refreshReservePrice,
  SuilendClient,
  type ParsedReserve,
} from "@suilend/sdk";
import type { Swapper } from "../swappers";
import { SuiPriceServiceConnection } from "@pythnetwork/pyth-sui-js";
import { SuiClient } from "@mysten/sui/client";
import { logger } from "../logger";
import { StatsD } from "hot-shots";
import {
  LendingMarket,
  ObligationOwnerCap,
} from "@suilend/sdk/_generated/suilend/lending-market/structs";
import { phantom } from "@suilend/sdk/_generated/_framework/reified";
import { getCoinMetadataMap, getInputCoins } from "../lib";
import { normalizeStructTag, SUI_TYPE_ARG } from "@mysten/sui/utils";
import { borrowLimit } from "@suilend/sdk/_generated/suilend/reserve-config/functions";
import { COIN_DECIMALS, COIN_TYPE_LIST, STABLE_COIN_TYPES } from "../const";
import {
  Transaction,
  type TransactionObjectInput,
} from "@mysten/sui/transactions";
import { obligationId } from "@suilend/sdk/_generated/suilend/lending-market/functions";
import type { Obligation } from "@suilend/sdk/_generated/suilend/obligation/structs";
import type { SuilendObligation } from "../../type";
import type { CetusSwapper } from "../swappers/cetus";

export type SuilendBotConfig = {
  keypair: Ed25519Keypair | Secp256k1Keypair;
  rpcURL: string;
  swapper: CetusSwapper;
  lendingMarketType: string;
  marketAddress: string;
  pollingIntervalSeconds: number;
  refetchIntervalSeconds: number;
  statsd: StatsD;
};

export class SuilendBot {
  config: SuilendBotConfig;
  keypair: Ed25519Keypair | Secp256k1Keypair;
  obligationList: string[] = [];
  suiClient: SuiClient;
  swapper: CetusSwapper;
  suilend?: SuilendClient;
  pythConnection: SuiPriceServiceConnection;
  statsd: StatsD;
  obligationOwnerCap?: ObligationOwnerCap<string>;
  obligation?: SuilendObligation | null;

  constructor(config: SuilendBotConfig) {
    this.config = config;
    this.keypair = config.keypair;
    this.suiClient = new SuiClient({ url: config.rpcURL });
    this.swapper = config.swapper;
    this.pythConnection = new SuiPriceServiceConnection(
      "https://hermes.pyth.network",
    );
    this.statsd = new StatsD({ mock: true });
  }

  async setup() {
    this.suilend = await SuilendClient.initialize(
      this.config.marketAddress,
      this.config.lendingMarketType,
      this.suiClient,
    );

    const now = Math.round(Date.now() / 1000);

    // raw lending market
    const rawLendingMarket = await LendingMarket.fetch(
      this.suiClient,
      phantom(LENDING_MARKET_TYPE),
      LENDING_MARKET_ID,
    );
    // fetch market supported reserves
    const refreshedRawReserves = await refreshReservePrice(
      rawLendingMarket.reserves.map((r) => compoundReserveInterest(r, now)),
      new SuiPriceServiceConnection("https://hermes.pyth.network"),
    );

    // query All coinMetadata for supported types
    const coinTypes: string[] = [];
    refreshedRawReserves.forEach((r) => {
      coinTypes.push(normalizeStructTag(r.coinType.name));

      [
        ...r.depositsPoolRewardManager.poolRewards,
        ...r.borrowsPoolRewardManager.poolRewards,
      ].forEach((pr) => {
        if (!pr) return;
        coinTypes.push(normalizeStructTag(pr.coinType.name));
      });
    });
    const coinMetadataMap = await getCoinMetadataMap(
      this.suiClient,
      Array.from(new Set(coinTypes)),
    );
    // parsed lendin market
    const lendingMarket = parseLendingMarket(
      rawLendingMarket,
      refreshedRawReserves,
      coinMetadataMap,
      now,
    );
    const reserveMap = lendingMarket.reserves.reduce(
      (acc, reserve) => ({ ...acc, [reserve.coinType]: reserve }),
      {},
    ) as Record<string, ParsedReserve>;

    // personal obligations
    // - get all obligationIds
    let obligationOwnerCaps = await SuilendClient.getObligationOwnerCaps(
      this.keypair.toSuiAddress(),
      rawLendingMarket.$typeArgs,
      this.suiClient,
    );
    this.obligationList = obligationOwnerCaps.map(
      (obligationCap) => obligationCap.obligationId,
    );

    if (obligationOwnerCaps.length == 0) throw "No obligations found";
    this.obligationOwnerCap = obligationOwnerCaps[0];
    const obligations = (
      await Promise.all(
        this.obligationList.map((obligationId) =>
          this.suilend!.getObligation(obligationId),
        ),
      )
    )
      .map((rawObligation) =>
        refreshObligation(rawObligation, refreshedRawReserves),
      )
      .map((refreshedObligation) =>
        parseObligation(refreshedObligation, reserveMap),
      )
      // Descending order by position value
      .sort((a, b) => b.netValueUsd.toNumber() - a.netValueUsd.toNumber());

    this.obligation = obligations[0];
  }

  async run() {
    await this.setup();
    if (!this.suilend || !this.obligationOwnerCap || !this.obligation)
      throw "Suilend not setup";

    const liquidityInfo = await this.swapper.fetchLPPositions(
      "0x30b7881f9b24d9ed2507604d911dd73e430462d6eafb0918f061fc65551ffefe",
    );

    if (
      liquidityInfo.coinAAmount === "0" ||
      liquidityInfo.coinBAmount === "0"
    ) {
      throw "LP position leave range";
      // TODO: repay all the assets in suilend to offset the debt
    } else {
      const isCoinAStable = STABLE_COIN_TYPES.includes(
        liquidityInfo.coinA as any,
      );
      const isCoinBStable = STABLE_COIN_TYPES.includes(
        liquidityInfo.coinB as any,
      );

      if (!isCoinAStable && !isCoinBStable) throw "Unsupported LP position";
      if (isCoinAStable && isCoinBStable) throw "Stable LP position";

      const hedgedAssetType = isCoinAStable
        ? liquidityInfo.coinB
        : liquidityInfo.coinA;

      // parse obligation
      const deposits = this.obligation.deposits.map((deposit) => ({
        coinType: deposit.coinType,
        amount: deposit.depositedAmount.toNumber(),
      }));
      const borrows = this.obligation.borrows.map((borrow) => ({
        coinType: borrow.coinType,
        amount: borrow.borrowedAmount.toNumber(),
      }));
      const liquidationThresholdUsd =
        this.obligation.unhealthyBorrowValueUsd.toNumber();
      const borrowLimitUsd = this.obligation.borrowLimitUsd.toNumber();

      logger.info({
        totalDepositUsd: this.obligation.depositedAmountUsd.toNumber(),
        totalBorrowUsd: this.obligation.borrowedAmountUsd.toNumber(),
        positionNetUsd: this.obligation.netValueUsd.toNumber(),
        deposits,
        borrows,
        liquidationThresholdUsd,
        borrowLimitUsd,
      });
    }
  }

  // PTB
  deposit_(
    tx: Transaction,
    obligation: TransactionObjectInput,
    coin: TransactionObjectInput,
    coinType: string,
  ) {
    if (!this.suilend) throw "Suilend client not setup";
    this.suilend.deposit(coin, coinType, obligation, tx);
  }

  async borrow_(
    tx: Transaction,
    obligationOwnerCapId: string,
    obligationId: string,
    coinType: string,
    value: BigInt,
  ) {
    if (!this.suilend) throw "Suilend client not setup";
    return await this.suilend.borrow(
      obligationOwnerCapId,
      obligationId,
      coinType,
      value.toString(),
      tx,
    );
  }

  async dryRun(tx: Transaction) {
    tx.setSender(this.keypair.toSuiAddress());
    const bytes = await tx.build({ client: this.suiClient });
    return await this.suiClient.dryRunTransactionBlock({
      transactionBlock: bytes,
    });
  }

  async executeTransaction(tx: Transaction) {
    const transactionBlock = await tx.build({ client: this.suiClient });
    const signature = (await this.keypair.signTransaction(transactionBlock))
      .signature;
    return await this.suiClient.executeTransactionBlock({
      transactionBlock,
      signature,
    });
  }
}
