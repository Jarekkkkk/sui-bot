import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Secp256k1Keypair } from "@mysten/sui/keypairs/secp256k1";
import { SuiClient } from "@mysten/sui/client";
import { type SwapArgs, type Swapper } from "../index";
import {
  Transaction,
  type TransactionObjectArgument,
} from "@mysten/sui/transactions";
import { getInputCoins } from "../../lib";
import { CetusSwapper } from "../cetus";

export class SevenKSwapper implements Swapper {
  keypair: Ed25519Keypair | Secp256k1Keypair;
  suiClient: SuiClient;

  constructor(keypair: Ed25519Keypair | Secp256k1Keypair, rpcURL: string) {
    this.keypair = keypair;
    this.suiClient = new SuiClient({ url: rpcURL });
  }

  async init() {}

  async swap(args: SwapArgs): Promise<{
    fromCoin: TransactionObjectArgument;
    toCoin: TransactionObjectArgument;
    txb: Transaction;
  } | null> {
    if (
      (args.fromAmount && args.toAmount) ||
      (!args.fromAmount && !args.toAmount)
    ) {
      throw new Error("Must specify exactly one of fromAmount or toAmount");
    }

    const tx = new Transaction();

    return null;
  }
}
