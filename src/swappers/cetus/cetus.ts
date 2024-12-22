import CetusClmmSDK, {
  type AddLiquidityFixTokenParams,
  ClmmPoolUtil,
  type SdkOptions,
  TickMath,
  TransactionUtil,
} from "@cetusprotocol/cetus-sui-clmm-sdk";
import { SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Secp256k1Keypair } from "@mysten/sui/keypairs/secp256k1";
import {
  Transaction,
  type TransactionObjectArgument,
} from "@mysten/sui/transactions";
import BN from "bn.js";
import { type SwapArgs, type Swapper } from "../index";

import { MAINNET_POOL_INFO_URL } from "./configs";
import { logger } from "../../logger";
import { buildTx } from "@7kprotocol/sdk-ts";
import {
  AggregatorClient,
  type RouterData,
} from "@cetusprotocol/aggregator-sdk";
import { getInputCoins } from "../../lib";

export type CetusConstructorArgs = {
  keypair: Ed25519Keypair | Secp256k1Keypair;
  poolInfoURL?: string;
  sdkOptions: SdkOptions;
  rpcURL: string;
};

type LPCoin = {
  name: string;
  symbol: string;
  decimals: number;
  address: string;
  balance: string;
  logo_url: string;
  coingecko_id: string;
  project_url: string;
  labels: any[];
};

type LPInfo = {
  symbol: string;
  name: string;
  decimals: number;
  fee: string;
  tick_spacing: string;
  pool_type: string;
  address: string;
  coin_a_address: string;
  coin_b_address: string;
  is_closed: boolean;
  coin_a: LPCoin;
  coin_b: LPCoin;
};

export class CetusSwapper implements Swapper {
  keypair: Ed25519Keypair | Secp256k1Keypair;
  poolInfoURL: string;
  lpList: LPInfo[];
  sdk: CetusClmmSDK;
  suiClient: SuiClient;
  aggregator: AggregatorClient;

  constructor(args: CetusConstructorArgs) {
    this.keypair = args.keypair;
    this.poolInfoURL = args.poolInfoURL || MAINNET_POOL_INFO_URL;
    this.lpList = [];
    this.sdk = new CetusClmmSDK(args.sdkOptions);
    this.suiClient = new SuiClient({ url: args.rpcURL });
    this.aggregator = new AggregatorClient();
  }

  async init() {
    // await this.refreshPoolInfo();
    this.sdk.senderAddress = this.keypair.toSuiAddress();
  }

  // TODO
  async refreshPoolInfo() {
    const coinMap = new Map();
    const poolMap = new Map();
    const resp: any = await fetch(this.poolInfoURL, { method: "GET" });
    const pools = await this.sdk.Pool.getPools();
    logger.info(pools);
    const poolsInfo = (await resp.json()) as {
      code: number;
      msg: string;
      data: { lp_list: LPInfo[] };
    };
    if (poolsInfo.code !== 200) {
      return false;
    }
    const newLPList: LPInfo[] = [];
    for (const pool of poolsInfo.data.lp_list) {
      if (pool.is_closed) {
        continue;
      }
      newLPList.push(pool);
      const coin_a = pool.coin_a.address;
      const coin_b = pool.coin_b.address;

      coinMap.set(coin_a, {
        address: pool.coin_a.address,
        decimals: pool.coin_a.decimals,
      });
      coinMap.set(coin_b, {
        address: pool.coin_b.address,
        decimals: pool.coin_b.decimals,
      });

      const pair = `${coin_a}-${coin_b}`;
      const pathProvider = poolMap.get(pair);
      if (pathProvider) {
        pathProvider.addressMap.set(Number(pool.fee) * 100, pool.address);
      } else {
        poolMap.set(pair, {
          base: coin_a,
          quote: coin_b,
          addressMap: new Map([[Number(pool.fee) * 100, pool.address]]),
        });
      }
    }
    this.lpList = newLPList;
    this.sdk.Router.loadGraph(
      {
        coins: Array.from(coinMap.values()),
      },
      {
        paths: Array.from(poolMap.values()),
      },
    );
  }

  async createPosition(poolObjectId: string) {
    // get Pool info
    const pool = await this.sdk.Pool.getPool(poolObjectId);
    logger.info({ pool });
    // get ticks
    const lowerTick = TickMath.getPrevInitializableTickIndex(
      new BN(pool.current_tick_index).toNumber(),
      new BN(pool.tickSpacing).toNumber(),
    );
    const upperTick = TickMath.getNextInitializableTickIndex(
      new BN(pool.current_tick_index).toNumber(),
      new BN(pool.tickSpacing).toNumber(),
    );
    const coinAmount = new BN(100);
    const fix_amount_a = true;
    const slippage = 0.01;
    const curSqrtPrice = new BN(pool.current_sqrt_price);

    // const liquidityInput = ClmmPoolUtil.estimateLiquidityFromcoinAmounts(curSqrtPrice,lowerTick, upperTick, oin)
    const liquidityInput = ClmmPoolUtil.estLiquidityAndcoinAmountFromOneAmounts(
      lowerTick,
      upperTick,
      coinAmount,
      fix_amount_a,
      true,
      slippage,
      curSqrtPrice,
    );

    logger.info({ liquidityInput });

    const amount_a = fix_amount_a
      ? coinAmount.toNumber()
      : liquidityInput.tokenMaxA.toNumber();
    const amount_b = fix_amount_a
      ? liquidityInput.tokenMaxB.toNumber()
      : coinAmount.toNumber();

    // build addLiquidity params
    const addLiquidityPayloadParams: AddLiquidityFixTokenParams = {
      coinTypeA: pool.coinTypeA,
      coinTypeB: pool.coinTypeB,
      pool_id: pool.poolAddress,
      tick_lower: lowerTick.toString(),
      tick_upper: upperTick.toString(),
      fix_amount_a,
      amount_a,
      amount_b,
      slippage,
      is_open: true,
      rewarder_coin_types: [],
      collect_fee: false,
      pos_id: "",
    };

    return await this.sdk.Position.createAddLiquidityFixTokenPayload(
      addLiquidityPayloadParams,
      {
        slippage,
        curSqrtPrice,
      },
    );
  }

  async quoteRouter(args: SwapArgs): Promise<RouterData | null> {
    if (
      (args.fromAmount && args.toAmount) ||
      (!args.fromAmount && !args.toAmount)
    ) {
      throw new Error("Must specify exactly one of fromAmount or toAmount");
    }
    const byAmountIn = Boolean(args.fromAmount);
    // query the route
    const routerData = await this.aggregator.findRouters({
      from: args.fromCoinType,
      target: args.toCoinType,
      amount: byAmountIn ? new BN(args.fromAmount!) : new BN(args.toAmount!),
      byAmountIn, // true means fix input amount, false means fix output amount
    });
    logger.info({
      quote: {
        amountIn: routerData?.amountIn.toString(),
        amountOut: routerData?.amountOut.toString(),
      },
    });

    return routerData;
  }

  async swap_(
    tx: Transaction,
    inputCoin: TransactionObjectArgument,
    routerData: RouterData,
    byAmountIn: boolean,
    slippage: number,
  ) {
    return await this.aggregator.routerSwap({
      routers: routerData.routes,
      byAmountIn,
      txb: tx,
      inputCoin,
      slippage,
    });
  }

  async swap(args: SwapArgs): Promise<Transaction | null> {
    const routerData = await this.quoteRouter(args);

    const tx = new Transaction();
    const byAmountIn = Boolean(args.fromAmount);
    if (routerData != null) {
      const inputCoin = await getInputCoins(
        tx,
        this.suiClient,
        this.keypair.toSuiAddress(),
        byAmountIn ? args.fromCoinType : args.toCoinType,
        routerData?.amountIn.toString(),
      );
      const outputCoin = await this.swap_(
        tx,
        inputCoin,
        routerData,
        byAmountIn,
        args.maxSlippage,
      );

      tx.transferObjects([outputCoin], this.keypair.toSuiAddress());
      return tx;
    }

    return null;
  }
}