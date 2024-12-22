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
import { LendingMarket } from "@suilend/sdk/_generated/suilend/lending-market/structs";
import { phantom } from "@suilend/sdk/_generated/_framework/reified";
import { getCoinMetadataMap } from "../lib";
import { normalizeStructTag, SUI_TYPE_ARG } from "@mysten/sui/utils";
import { borrowLimit } from "@suilend/sdk/_generated/suilend/reserve-config/functions";
import { COIN_DECIMALS, COIN_TYPE_LIST } from "../const";
import { Transaction } from "@mysten/sui/transactions";

export type SuilendBotConfig = {
  keypair: Ed25519Keypair | Secp256k1Keypair;
  rpcURL: string;
  swapper: Swapper;
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
  swapper: Swapper;
  suilend?: SuilendClient;
  pythConnection: SuiPriceServiceConnection;
  statsd: StatsD;

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

  async run() {
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

    const obligation = obligations[0];

    // parse obligation information
    const deposits = obligation.deposits.map((deposit) => ({
      coinType: deposit.coinType,
      amount: deposit.depositedAmount.toNumber(),
    }));
    const borrows = obligation.borrows.map((borrow) => ({
      coinType: borrow.coinType,
      amount: borrow.borrowedAmount.toNumber(),
    }));

    logger.info({
      totalDepositUsd: obligation.depositedAmountUsd.toNumber(),
      totalBorrowUsd: obligation.borrowedAmountUsd.toNumber(),
      deposits,
      borrows,
      borrowLimit: obligation.borrowLimit.toNumber(),
      minPriceBorrowLimitUsd: obligation.minPriceBorrowLimitUsd.toNumber(),
    });
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
