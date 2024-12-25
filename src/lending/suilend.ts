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
import { normalizeStructTag, SUI_TYPE_ARG, toHex } from "@mysten/sui/utils";
import { borrowLimit } from "@suilend/sdk/_generated/suilend/reserve-config/functions";
import { COIN_DECIMALS, COIN_TYPE_LIST, STABLE_COIN_TYPES } from "../const";
import {
  Transaction,
  type TransactionObjectInput,
} from "@mysten/sui/transactions";
import {
  obligationId,
  reserve,
} from "@suilend/sdk/_generated/suilend/lending-market/functions";
import { Obligation } from "@suilend/sdk/_generated/suilend/obligation/structs";
import type { COIN, SuilendObligation } from "../../type";
import type { CetusSwapper } from "../swappers/cetus";
import type { Reserve } from "@suilend/sdk/_generated/suilend/reserve/structs";

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
  obligation?: SuilendObligation;
  reserves?: Record<string, ParsedReserve>;

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
    this.swapper.init();

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
    this.reserves = reserveMap;

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

  async openHedgedPosition(
    poolObjectId: string,
    lowerPrice: number,
    upperPrice: number,
    percentage: number,
    depositedAmount: number,
    depositedStableCoinType: string,
  ) {
    await this.setup();
    if (
      !this.suilend ||
      !this.obligationOwnerCap ||
      !this.obligation ||
      !this.reserves
    )
      throw "Suilend not setup";

    // quote by 1000
    const coinAmount = BigInt(1000 * 10 ** COIN_DECIMALS.USDC);
    const fix_amount_a = true;
    const liquidityInfo = await this.swapper.quotePosition(
      poolObjectId,
      lowerPrice,
      upperPrice,
      coinAmount,
      fix_amount_a,
    );
    if (liquidityInfo.coinAmountA === 0 || liquidityInfo.coinAmountB === 0)
      throw "LP position leave range";

    const {
      hedgedAssetType,
      hedgedAssetSymbol,
      hedgedAssetAmount,
      stableAssetType,
      stableAssetSymbol,
      stableAssetAmount,
    } = this.parseLiquidityInfo({
      coinA: liquidityInfo.coinA,
      coinB: liquidityInfo.coinB,
      coinAAmount: liquidityInfo.coinAmountA,
      coinBAmount: liquidityInfo.coinAmountB,
    });

    const hedgedAssetAmount_ =
      hedgedAssetAmount / 10 ** COIN_DECIMALS[hedgedAssetSymbol as COIN];
    const stableAssetAmount_ =
      stableAssetAmount / 10 ** COIN_DECIMALS[stableAssetSymbol as COIN];

    logger.info({
      hedgedAssetType,
      hedgedAssetSymbol,
      hedgedAssetAmount: hedgedAssetAmount_,
      stableAssetSymbol,
      stableAssetAmount: stableAssetAmount_,
    });

    const price = this.reserves?.[hedgedAssetType].price;
    if (!price) throw `Failed to fetch price for ${hedgedAssetSymbol}`;
    const hedgedAssetUsd = price.toNumber() * hedgedAssetAmount_;

    const requiredDepositUsd = hedgedAssetUsd / percentage;

    const percentageInSuilend =
      requiredDepositUsd / (requiredDepositUsd + 1000);

    const amountInSuilend = Math.floor(depositedAmount * percentageInSuilend);
    const stableAmountForLP = depositedAmount - amountInSuilend;

    // {
    //   // prepare transaction
    //   const tx = new Transaction();
    //   // 1. deposit on Suilend
    //   const inputCoin = await getInputCoins(
    //     tx,
    //     this.suiClient,
    //     this.keypair.toSuiAddress(),
    //     depositedStableCoinType,
    //     amountInSuilend.toString(),
    //   );
    //   this.deposit_(
    //     tx,
    //     tx.object(this.obligationOwnerCap.id),
    //     inputCoin,
    //     depositedStableCoinType,
    //   );
    //
    //   logger.info(
    //     `deposit ${amountInSuilend / 10 ** COIN_DECIMALS[stableAssetSymbol as COIN]} ${stableAssetSymbol}`,
    //   );
    //
    //   // 2. borrow on Suilend
    const openedPositionLiquidityInfo = await this.swapper.quotePosition(
      poolObjectId,
      lowerPrice,
      upperPrice,
      BigInt(stableAmountForLP),
      fix_amount_a,
    );
    const loanAmount = openedPositionLiquidityInfo.coinAmountB;
    //   const obligation = await this.suilend.getObligation(this.obligation.id);
    //   await this.refreshReservePrice(tx, [
    //     this.reserves[depositedStableCoinType],
    //     this.reserves[hedgedAssetType],
    //   ]);
    //   const loadnCoin = await this.borrow_(
    //     tx,
    //     this.obligationOwnerCap.id,
    //     this.obligation.id,
    //     hedgedAssetType,
    //     BigInt(loanAmount),
    //   );
    //   logger.info(
    //     `borrow ${loanAmount / 10 ** COIN_DECIMALS[hedgedAssetSymbol as COIN]} ${hedgedAssetSymbol}`,
    //   );
    //
    //   tx.transferObjects([loadnCoin], this.keypair.toSuiAddress());
    //   // 3. deposit LP
    //
    //   const devResponse = await this.dryRun(tx);
    //   if (devResponse.effects.status.status === "failure")
    //     throw "dryRun failed at borrowing from Suilend";
    //   const response = await this.executeTransaction(tx);
    //   if (response.effects?.status.status === "failure")
    //     throw "transaction execution failed at borrowing from Suilend";
    // }

    // TODO: distinguish whether is stable assets
    const txWithLPOpenedPosition = await this.swapper.createPosition(
      poolObjectId,
      lowerPrice,
      upperPrice,
      stableAmountForLP,
      loanAmount,
    );

    txWithLPOpenedPosition.setSender(this.keypair.toSuiAddress());
    await this.executeTransaction(txWithLPOpenedPosition);

    // const devResponse_ = await this.dryRun(txWithLPOpenedPosition);
    // logger.debug({ devResponse: devResponse_ });
  }

  async run(positionId: string) {
    await this.setup();
    if (
      !this.suilend ||
      !this.obligationOwnerCap ||
      !this.obligation ||
      !this.reserves
    )
      throw "Suilend not setup";

    const liquidityInfo = await this.swapper.fetchLPPositions(positionId);

    if (liquidityInfo.coinAAmount === 0 || liquidityInfo.coinBAmount === 0) {
      throw "LP position leave range";
      // TODO: repay all the assets in suilend to offset the debt
    } else {
      const {
        hedgedAssetType,
        hedgedAssetSymbol,
        hedgedAssetAmount,
        stableAssetSymbol,
        stableAssetType,
        stableAssetAmount,
      } = this.parseLiquidityInfo(liquidityInfo);

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

      // obligation validation
      if (
        this.obligation.maxPriceWeightedBorrowsUsd >
        this.obligation.minPriceBorrowLimitUsd
      )
        throw "Unhealthy obligation";

      const hedgedAssetReserve = this.reserves[hedgedAssetType];

      const borrowFee = hedgedAssetReserve.config.borrowFeeBps / 10000;
      const maxBorrowAmount = this.obligation.minPriceBorrowLimitUsd
        .minus(this.obligation.maxPriceWeightedBorrowsUsd)
        .div(
          hedgedAssetReserve.maxPrice.times(
            hedgedAssetReserve.config.borrowWeightBps / 10000,
          ),
        )
        .div(1 + borrowFee);

      logger.info({ maxBorrowAmount: maxBorrowAmount.toNumber() });

      const obligationLoanAmount = borrows.find(
        (borrow) => borrow.coinType == hedgedAssetType,
      );

      if (!obligationLoanAmount) throw `No loan for ${hedgedAssetType}`;

      const formatHedgedAmount =
        hedgedAssetAmount / 10 ** COIN_DECIMALS[hedgedAssetSymbol as COIN];
      logger.info({
        hedgedAssetAmount: formatHedgedAmount,
        hedgedAssetSymbol,
        obligationLoanAmount,
      });

      const diff = obligationLoanAmount.amount - formatHedgedAmount;

      const maxSlippage = 0.005;
      const tx = new Transaction();
      if (diff > 0) {
        //over-hedged: swap stable assets for repaying the loan
        logger.info(
          `${Math.abs(diff)} ${hedgedAssetSymbol} needs to be repaied`,
        );
        const repaidAmount = Math.floor(
          diff * 10 ** COIN_DECIMALS[hedgedAssetSymbol as COIN],
        );
        const quote = await this.swapper.quoteRouter({
          fromCoinType: stableAssetType,
          toCoinType: hedgedAssetType,
          toAmount: repaidAmount,
          maxSlippage,
        });
        if (!quote) throw "Failed to find the quote";
        await this.refreshReservePrice(tx, [
          this.reserves[stableAssetType],
          this.reserves[hedgedAssetType],
        ]);

        const swappedCoin = await this.withdraw_(
          tx,
          this.obligationOwnerCap.id,
          this.obligation.id,
          stableAssetType,
          quote.amountIn.toString(),
        );

        const outputCoin = await this.swapper.swap_(
          tx,
          swappedCoin,
          quote,
          false,
          maxSlippage,
        );
        this.repay(tx, this.obligation.id, hedgedAssetType, outputCoin);
        tx.transferObjects([outputCoin], this.keypair.toSuiAddress());
      } else {
        //require-hedged: borrow more loan and swap for stablecoin then deposit back to Suilend
        logger.info(
          `${Math.abs(diff)} ${hedgedAssetSymbol} needs to be hedged`,
        );
        const loanAmount = Math.floor(
          Math.abs(diff) * 10 ** COIN_DECIMALS[hedgedAssetSymbol as COIN],
        );
        const quote = await this.swapper.quoteRouter({
          fromCoinType: hedgedAssetType,
          toCoinType: stableAssetType,
          fromAmount: loanAmount,
          maxSlippage,
        });
        if (!quote) throw "Failed to find the quote";
        const obligation = await this.suilend.getObligation(this.obligation.id);
        await this.refreshReservePrice(tx, [
          this.reserves[stableAssetType],
          this.reserves[hedgedAssetType],
        ]);
        const loanCoin = await this.borrow_(
          tx,
          this.obligationOwnerCap.id,
          this.obligation.id,
          hedgedAssetType,
          BigInt(loanAmount),
        );
        const outputCoin = await this.swapper.swap_(
          tx,
          loanCoin,
          quote,
          true,
          maxSlippage,
        );

        this.deposit_(
          tx,
          tx.object(this.obligationOwnerCap.id),
          outputCoin,
          stableAssetType,
        );
      }
      const devResponse = await this.dryRun(tx);
      if (devResponse.effects.status.status === "failure")
        throw "Dry run failed at rebalancing";

      const response = await this.executeTransaction(tx);
      logger.info({ response });
    }
  }

  async refreshReservePrice(tx: Transaction, reserves: ParsedReserve[]) {
    for (const reserve of reserves) {
      const priceInfoObjectId =
        await this.suilend?.pythClient.getPriceFeedObjectId(
          reserve.priceIdentifier,
        );

      if (!priceInfoObjectId)
        throw `priceIdentifier object not found for ${reserve.coinType}`;
      await this.suilend?.refreshReservePrices(
        tx,
        priceInfoObjectId,
        reserve.arrayIndex,
      );
    }
  }

  parseLiquidityInfo(liquidityInfo: {
    coinA: string;
    coinB: string;
    coinAAmount: number;
    coinBAmount: number;
  }) {
    const isCoinAStable = STABLE_COIN_TYPES.includes(
      liquidityInfo.coinA as any,
    );
    const isCoinBStable = STABLE_COIN_TYPES.includes(
      liquidityInfo.coinB as any,
    );

    if (!isCoinAStable && !isCoinBStable) throw "Unsupported LP position";
    if (isCoinAStable && isCoinBStable) throw "Stable LP position";

    const symbols = isCoinAStable
      ? [liquidityInfo.coinB, liquidityInfo.coinA]
      : [liquidityInfo.coinA, liquidityInfo.coinB];
    const amounts = isCoinAStable
      ? [liquidityInfo.coinBAmount, liquidityInfo.coinAAmount]
      : [liquidityInfo.coinAAmount, liquidityInfo.coinBAmount];
    const hedgedAssetType = normalizeStructTag(
      COIN_TYPE_LIST[symbols[0] as COIN],
    );
    const hedgedAssetAmount = Number(
      isCoinAStable ? liquidityInfo.coinBAmount : liquidityInfo.coinAAmount,
    );
    return {
      hedgedAssetSymbol: symbols[0],
      hedgedAssetType: normalizeStructTag(COIN_TYPE_LIST[symbols[0] as COIN]),
      hedgedAssetAmount: amounts[0],
      stableAssetSymbol: symbols[1],
      stableAssetType: normalizeStructTag(COIN_TYPE_LIST[symbols[1] as COIN]),
      stableAssetAmount: amounts[1],
    };
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

  async withdraw_(
    tx: Transaction,
    obligationOwnerCapId: string,
    obligationId: string,
    coinType: string,
    value: string,
  ) {
    if (!this.suilend) throw "Suilend client not setup";
    return await this.suilend.withdraw(
      obligationOwnerCapId,
      obligationId,
      coinType,
      value,
      tx,
    );
  }

  async borrow_(
    tx: Transaction,
    obligationOwnerCapId: string,
    obligationId: string,
    coinType: string,
    value: BigInt,
  ) {
    if (!this.suilend || !this.obligation) throw "Suilend client not setup";

    return await this.suilend.borrow(
      obligationOwnerCapId,
      obligationId,
      coinType,
      value.toString(),
      tx,
    );
  }

  repay(
    tx: Transaction,
    obligationId: string,
    coinType: string,
    coin: TransactionObjectInput,
  ) {
    if (!this.suilend || !this.obligation) throw "Suilend client not setup";

    this.suilend.repay(obligationId, coinType, coin, tx);
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
