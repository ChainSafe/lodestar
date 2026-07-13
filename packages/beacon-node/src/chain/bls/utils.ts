import {ISignatureSet, SignatureSetType} from "@lodestar/state-transition";
import {type PubkeyCache, PublicKey} from "@lodestar/state-transition/bls";
import {Metrics} from "../../metrics/metrics.js";

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
      const aggregated = pubkeyCache.aggregate(signatureSet.indices);
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
