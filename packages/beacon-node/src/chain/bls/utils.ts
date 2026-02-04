import {PublicKey, aggregatePublicKeys} from "@chainsafe/blst";
import {ISignatureSet, Index2PubkeyCache, SignatureSetType} from "@lodestar/state-transition";
import {Metrics} from "../../metrics/metrics.js";

export function getAggregatedPubkey(
  signatureSet: ISignatureSet,
  index2pubkey: Index2PubkeyCache,
  metrics: Metrics | null = null
): PublicKey {
  switch (signatureSet.type) {
    case SignatureSetType.single:
      return signatureSet.pubkey;

    case SignatureSetType.indexed:
      return index2pubkey[signatureSet.index];

    case SignatureSetType.aggregate: {
      const timer = metrics?.blsThreadPool.pubkeysAggregationMainThreadDuration.startTimer();
      const pubkeys = signatureSet.indices.map((i) => index2pubkey[i]);
      const aggregated = aggregatePublicKeys(pubkeys);
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
