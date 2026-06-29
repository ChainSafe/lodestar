import {PublicKey, aggregatePublicKeys} from "@chainsafe/lodestar-z/blst";
import {ISignatureSet, PubkeyCache, SignatureSetType} from "@lodestar/state-transition";
import {Metrics} from "../../metrics/metrics.js";

type NativeAggregatingPubkeyCache = PubkeyCache & {
  aggregate?: (indices: number[]) => PublicKey;
};

export function getAggregatedPubkey(
  signatureSet: ISignatureSet,
  pubkeyCache: PubkeyCache,
  metrics: Metrics | null = null
): PublicKey {
  switch (signatureSet.type) {
    case SignatureSetType.single:
      return signatureSet.pubkey;

    case SignatureSetType.indexed: {
      return pubkeyCache.getOrThrow(signatureSet.index);
    }

    case SignatureSetType.aggregate: {
      const timer = metrics?.blsThreadPool.pubkeysAggregationMainThreadDuration.startTimer();
      const aggregateByIndex = (pubkeyCache as NativeAggregatingPubkeyCache).aggregate;
      const aggregated =
        aggregateByIndex !== undefined
          ? aggregateByIndex.call(pubkeyCache, signatureSet.indices)
          : aggregatePublicKeys(signatureSet.indices.map((i) => pubkeyCache.getOrThrow(i)));
      timer?.();
      return aggregated;
    }

    default:
      throw Error("Unknown signature set type");
  }
}

export function getAggregatedPubkeysCount(signatureSets: ISignatureSet[]): number {
  let pubkeysCount = 0;
  for (const set of signatureSets) {
    if (set.type === SignatureSetType.aggregate) {
      pubkeysCount += set.indices.length;
    }
  }
  return pubkeysCount;
}
