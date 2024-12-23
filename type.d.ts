export type COIN =
  | "SUI"
  // LST
  | "afSUI"
  | "haSUI"
  | "vSUI"
  | "sSUI"
  // stablecoins
  | "USDY"
  | "BUCK"
  | "wUSDT"
  | "USDC"
  | "AUSD"
  | "FDUSD"
  // eth
  | "ETH";
export type SuilendObligation = {
  id: string;
  depositedAmountUsd: BigNumber;
  borrowedAmountUsd: BigNumber;
  netValueUsd: BigNumber;
  weightedBorrowsUsd: BigNumber;
  maxPriceWeightedBorrowsUsd: BigNumber;
  borrowLimitUsd: BigNumber;
  minPriceBorrowLimitUsd: BigNumber;
  unhealthyBorrowValueUsd: BigNumber;
  depositPositionCount: number;
  borrowPositionCount: number;
  positionCount: number;
  deposits: {
    coinType: string;
    reserveArrayIndex: bigint;
    userRewardManagerIndex: number;
    userRewardManager: import("../_generated/suilend/liquidity-mining/structs").UserRewardManager;
    depositedAmount: BigNumber;
    depositedAmountUsd: BigNumber;
    depositedCtokenAmount: BigNumber;
    reserve: {
      config: {
        $typeName: string;
        openLtvPct: number;
        closeLtvPct: number;
        maxCloseLtvPct: number;
        borrowWeightBps: number;
        depositLimit: BigNumber;
        borrowLimit: BigNumber;
        liquidationBonusBps: number;
        maxLiquidationBonusBps: number;
        depositLimitUsd: BigNumber;
        borrowLimitUsd: BigNumber;
        borrowFeeBps: number;
        spreadFeeBps: number;
        protocolLiquidationFeeBps: number;
        isolated: boolean;
        openAttributedBorrowLimitUsd: number;
        closeAttributedBorrowLimitUsd: number;
        interestRate: {
          id: string;
          utilPercent: BigNumber;
          aprPercent: BigNumber;
        }[];
      };
      $typeName: string;
      id: string;
      arrayIndex: bigint;
      coinType: string;
      mintDecimals: number;
      priceIdentifier: string;
      price: BigNumber;
      smoothedPrice: BigNumber;
      minPrice: BigNumber;
      maxPrice: BigNumber;
      priceLastUpdateTimestampS: bigint;
      availableAmount: BigNumber;
      ctokenSupply: BigNumber;
      borrowedAmount: BigNumber;
      cumulativeBorrowRate: BigNumber;
      interestLastUpdateTimestampS: bigint;
      unclaimedSpreadFees: BigNumber;
      attributedBorrowValue: BigNumber;
      depositsPoolRewardManager: {
        $typeName: string;
        id: string;
        totalShares: bigint;
        poolRewards: {
          $typeName: string;
          id: string;
          poolRewardManagerId: string;
          coinType: string;
          startTimeMs: number;
          endTimeMs: number;
          totalRewards: BigNumber;
          allocatedRewards: BigNumber;
          cumulativeRewardsPerShare: BigNumber;
          numUserRewardManagers: bigint;
          rewardIndex: number;
          symbol: string;
          mintDecimals: number;
        }[];
        lastUpdateTimeMs: bigint;
      };
      borrowsPoolRewardManager: {
        $typeName: string;
        id: string;
        totalShares: bigint;
        poolRewards: {
          $typeName: string;
          id: string;
          poolRewardManagerId: string;
          coinType: string;
          startTimeMs: number;
          endTimeMs: number;
          totalRewards: BigNumber;
          allocatedRewards: BigNumber;
          cumulativeRewardsPerShare: BigNumber;
          numUserRewardManagers: bigint;
          rewardIndex: number;
          symbol: string;
          mintDecimals: number;
        }[];
        lastUpdateTimeMs: bigint;
      };
      availableAmountUsd: BigNumber;
      borrowedAmountUsd: BigNumber;
      depositedAmount: BigNumber;
      depositedAmountUsd: BigNumber;
      cTokenExchangeRate: BigNumber;
      borrowAprPercent: BigNumber;
      depositAprPercent: BigNumber;
      utilizationPercent: BigNumber;
      token: {
        decimals: number;
        description: string;
        iconUrl?: string | null;
        id?: string | null;
        name: string;
        symbol: string;
        coinType: string;
      };
      symbol: string;
      name: string;
      iconUrl: string | null | undefined;
      description: string;
      totalDeposits: BigNumber;
    };
    original: Obligation<string>;
  }[];
  borrows: {
    coinType: string;
    reserveArrayIndex: bigint;
    userRewardManagerIndex: number;
    userRewardManager: import("../_generated/suilend/liquidity-mining/structs").UserRewardManager;
    borrowedAmount: BigNumber;
    borrowedAmountUsd: BigNumber;
    reserve: {
      config: {
        $typeName: string;
        openLtvPct: number;
        closeLtvPct: number;
        maxCloseLtvPct: number;
        borrowWeightBps: number;
        depositLimit: BigNumber;
        borrowLimit: BigNumber;
        liquidationBonusBps: number;
        maxLiquidationBonusBps: number;
        depositLimitUsd: BigNumber;
        borrowLimitUsd: BigNumber;
        borrowFeeBps: number;
        spreadFeeBps: number;
        protocolLiquidationFeeBps: number;
        isolated: boolean;
        openAttributedBorrowLimitUsd: number;
        closeAttributedBorrowLimitUsd: number;
        interestRate: {
          id: string;
          utilPercent: BigNumber;
          aprPercent: BigNumber;
        }[];
      };
      $typeName: string;
      id: string;
      arrayIndex: bigint;
      coinType: string;
      mintDecimals: number;
      priceIdentifier: string;
      price: BigNumber;
      smoothedPrice: BigNumber;
      minPrice: BigNumber;
      maxPrice: BigNumber;
      priceLastUpdateTimestampS: bigint;
      availableAmount: BigNumber;
      ctokenSupply: BigNumber;
      borrowedAmount: BigNumber;
      cumulativeBorrowRate: BigNumber;
      interestLastUpdateTimestampS: bigint;
      unclaimedSpreadFees: BigNumber;
      attributedBorrowValue: BigNumber;
      depositsPoolRewardManager: {
        $typeName: string;
        id: string;
        totalShares: bigint;
        poolRewards: {
          $typeName: string;
          id: string;
          poolRewardManagerId: string;
          coinType: string;
          startTimeMs: number;
          endTimeMs: number;
          totalRewards: BigNumber;
          allocatedRewards: BigNumber;
          cumulativeRewardsPerShare: BigNumber;
          numUserRewardManagers: bigint;
          rewardIndex: number;
          symbol: string;
          mintDecimals: number;
        }[];
        lastUpdateTimeMs: bigint;
      };
      borrowsPoolRewardManager: {
        $typeName: string;
        id: string;
        totalShares: bigint;
        poolRewards: {
          $typeName: string;
          id: string;
          poolRewardManagerId: string;
          coinType: string;
          startTimeMs: number;
          endTimeMs: number;
          totalRewards: BigNumber;
          allocatedRewards: BigNumber;
          cumulativeRewardsPerShare: BigNumber;
          numUserRewardManagers: bigint;
          rewardIndex: number;
          symbol: string;
          mintDecimals: number;
        }[];
        lastUpdateTimeMs: bigint;
      };
      availableAmountUsd: BigNumber;
      borrowedAmountUsd: BigNumber;
      depositedAmount: BigNumber;
      depositedAmountUsd: BigNumber;
      cTokenExchangeRate: BigNumber;
      borrowAprPercent: BigNumber;
      depositAprPercent: BigNumber;
      utilizationPercent: BigNumber;
      token: {
        decimals: number;
        description: string;
        iconUrl?: string | null;
        id?: string | null;
        name: string;
        symbol: string;
        coinType: string;
      };
      symbol: string;
      name: string;
      iconUrl: string | null | undefined;
      description: string;
      totalDeposits: BigNumber;
    };
    original: Obligation<string>;
  }[];
  weightedConservativeBorrowUtilizationPercent: BigNumber;
  original: Obligation<string>;
  /**
   * @deprecated since version 1.0.3. Use `depositedAmountUsd` instead.
   */
  totalSupplyUsd: BigNumber;
  /**
   * @deprecated since version 1.0.3. Use `borrowedAmountUsd` instead.
   */
  totalBorrowUsd: BigNumber;
  /**
   * @deprecated since version 1.0.3. Use `weightedBorrowsUsd` instead.
   */
  totalWeightedBorrowUsd: BigNumber;
  /**
   * @deprecated since version 1.0.3. Use `maxPriceWeightedBorrowsUsd` instead.
   */
  maxPriceTotalWeightedBorrowUsd: BigNumber;
  /**
   * @deprecated since version 1.0.3. Use `borrowLimitUsd` instead.
   */
  borrowLimit: BigNumber;
  /**
   * @deprecated since version 1.0.3. Use `minPriceBorrowLimitUsd` instead.
   */
  minPriceBorrowLimit: BigNumber;
};
