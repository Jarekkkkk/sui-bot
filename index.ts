import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { program } from "commander";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import * as dotenv from "dotenv";
import { logger } from "./src/logger";
import { getFullnodeUrl, SuiClient } from "@mysten/sui/client";
import { SuilendBot } from "./src/lending/suilend";
import { LENDING_MARKET_ID, LENDING_MARKET_TYPE } from "@suilend/sdk";
import { StatsD } from "hot-shots";
import {
  CetusSwapper,
  MAINNET_CETUS_SDK_CONFIG,
  MAINNET_POOL_INFO_URL,
} from "./src/swappers/cetus";
import { COIN_TYPE_LIST } from "./src/const";
import { Transaction } from "@mysten/sui/transactions";

dotenv.config();

program.version("0.0.1");
// commands
program.command("run-suilend-bot").action(async () => {
  await runSuilendBot();
});
program.command("open-dex-position").action(async () => {
  await openDexPosition();
});
program.command("close-dex-position").action(async () => {
  await closeDexPosition();
});

// create keypair

const network: "mainnet" | "testnet" | "devnet" | "localnet" = "mainnet";

logger.info("Network: ", network);
const suiClient = new SuiClient({ url: getFullnodeUrl(network) });

function createSigner() {
  const secret = process.env?.BOT_PRIVATE_KEY;

  if (!secret) throw "BOT_PRIVATE_KEY env value not setup";
  const { secretKey } = decodeSuiPrivateKey(secret);
  return Ed25519Keypair.fromSecretKey(secretKey);
}

async function runSuilendBot() {
  const keypair = createSigner();
  logger.info(keypair.toSuiAddress());

  // swappper
  const sdkConfig = MAINNET_CETUS_SDK_CONFIG;
  sdkConfig.simulationAccount.address = keypair.toSuiAddress();
  const swapper = new CetusSwapper({
    keypair: keypair as any,
    poolInfoURL: MAINNET_POOL_INFO_URL,
    sdkOptions: sdkConfig,
    rpcURL: "https://fullnode.mainnet.sui.io/",
  });

  await swapper.init();
  const bot = new SuilendBot({
    keypair,
    lendingMarketType: LENDING_MARKET_TYPE,
    pollingIntervalSeconds: 15,
    refetchIntervalSeconds: 60 * 30,
    marketAddress: LENDING_MARKET_ID,
    rpcURL: "https://fullnode.mainnet.sui.io/",
    statsd: new StatsD({ mock: true }),
    swapper: swapper,
  });

  await bot.run();

  // await swapper.fetchLPPositions(
  //   "0x30b7881f9b24d9ed2507604d911dd73e430462d6eafb0918f061fc65551ffefe",
  // );

  // swap
  // const tx = await swapper.swap({
  //   fromCoinType: COIN_TYPE_LIST.SUI,
  //   toCoinType: COIN_TYPE_LIST.USDC,
  //   fromAmount: 10 ** 6,
  //   maxSlippage: 0.001, // 0.1%
  // });

  // if (devRes.effects.status.status === "success") {
  //   const transactionResult = await bot.executeTransaction(tx);
  //   logger.info({ transactionResult });
  // }
}

async function openDexPosition() {
  const keypair = createSigner();
  logger.info(keypair.toSuiAddress());

  const sdkConfig = MAINNET_CETUS_SDK_CONFIG;
  const swapper = new CetusSwapper({
    keypair: keypair as any,
    poolInfoURL: MAINNET_POOL_INFO_URL,
    sdkOptions: sdkConfig,
    rpcURL: "https://fullnode.mainnet.sui.io/",
  });

  await swapper.init();

  const bot = new SuilendBot({
    keypair,
    lendingMarketType: LENDING_MARKET_TYPE,
    pollingIntervalSeconds: 15,
    refetchIntervalSeconds: 60 * 30,
    marketAddress: LENDING_MARKET_ID,
    rpcURL: "https://fullnode.mainnet.sui.io/",
    statsd: new StatsD({ mock: true }),
    swapper: swapper,
  });

  const tx = await swapper.createPosition(
    "0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105",
    1 / 4.2,
    1 / 4.7,
    1000, // amount A
  );
  if (!tx) throw "Failed to build the tx";
  const devRes = await bot.dryRun(tx);
  logger.debug({ devRes });
  // if (devRes.effects.status.status === "success") {
  //   const transactionResult = await bot.executeTransaction(tx);
  //   logger.info({ transactionResult });
  // }
}

async function closeDexPosition() {
  const keypair = createSigner();
  logger.info(keypair.toSuiAddress());

  const sdkConfig = MAINNET_CETUS_SDK_CONFIG;
  const swapper = new CetusSwapper({
    keypair: keypair as any,
    poolInfoURL: MAINNET_POOL_INFO_URL,
    sdkOptions: sdkConfig,
    rpcURL: "https://fullnode.mainnet.sui.io/",
  });

  await swapper.init();

  const bot = new SuilendBot({
    keypair,
    lendingMarketType: LENDING_MARKET_TYPE,
    pollingIntervalSeconds: 15,
    refetchIntervalSeconds: 60 * 30,
    marketAddress: LENDING_MARKET_ID,
    rpcURL: "https://fullnode.mainnet.sui.io/",
    statsd: new StatsD({ mock: true }),
    swapper: swapper,
  });

  const tx = await swapper.closePosition(
    "0x562a5cc897099d794988e653f0a6ac6ea752c874e02171e91bdb198d786a0814",
  );
  if (!tx) throw "Failed to build the tx";
  const devRes = await bot.dryRun(tx);
  logger.debug({ devRes });
  if (devRes.effects.status.status === "success") {
    const transactionResult = await bot.executeTransaction(tx);
    logger.info({ transactionResult });
  }
}

program.parse();
