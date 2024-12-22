import {
  type Transaction,
  type TransactionObjectArgument,
} from "@mysten/sui/transactions";

export type SwapArgs = {
  fromCoinType: string;
  toCoinType: string;
  toAmount?: number;
  fromAmount?: number;
  maxSlippage: number;
};

export interface Swapper {
  init(): Promise<void>;
  swap(args: SwapArgs): Promise<Transaction | null>;
}
