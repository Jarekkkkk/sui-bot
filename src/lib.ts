import { type CoinMetadata, SuiClient } from "@mysten/sui/client";
import type { Transaction } from "@mysten/sui/transactions";
import { SUI_TYPE_ARG } from "@mysten/sui/utils";

export const getCoinMetadataMap = async (
  suiClient: SuiClient,
  uniqueCoinTypes: string[],
) => {
  try {
    const coinMetadata = await Promise.all(
      uniqueCoinTypes.map((ct) => suiClient.getCoinMetadata({ coinType: ct })),
    );
    const coinMetadataMap: Record<string, CoinMetadata> = {};
    for (let i = 0; i < uniqueCoinTypes.length; i++) {
      const metadata = coinMetadata[i];
      if (!metadata) continue;
      const coinType = uniqueCoinTypes[i];
      coinMetadataMap[coinType] = metadata;
    }
    return coinMetadataMap;
  } catch (err) {
    console.error(err);
    return {};
  }
};

export async function getInputCoins(
  tx: Transaction,
  client: SuiClient,
  owner: string,
  coinType: string,
  ...amounts: string[]
) {
  let isZero = true;
  for (const amount of amounts) {
    if (Number(amount) > 0) {
      isZero = false;
      break;
    }
  }

  if (isZero) {
    return tx.moveCall({
      target: `0x2::coin::zero`,
      typeArguments: [coinType],
    });
  }

  if (coinType === SUI_TYPE_ARG) {
    return tx.splitCoins(
      tx.gas,
      amounts.map((amount) => tx.pure.u64(amount)),
    );
  } else {
    const { data: userCoins } = await client.getCoins({ owner, coinType });
    const [mainCoin, ...otherCoins] = userCoins.map((coin) =>
      tx.objectRef({
        objectId: coin.coinObjectId,
        version: coin.version,
        digest: coin.digest,
      }),
    );
    if (!mainCoin) {
      return tx.moveCall({
        target: `0x2::coin::zero`,
        typeArguments: [coinType],
      });
    }

    if (otherCoins.length > 0) tx.mergeCoins(mainCoin, otherCoins);

    return tx.splitCoins(
      mainCoin,
      amounts.map((amount) => tx.pure.u64(amount)),
    );
  }
}
