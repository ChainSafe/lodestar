import {PublicKey, aggregatePublicKeys} from "@chainsafe/lodestar-z/blst";
import {ISignatureSet, PubkeyCache, SignatureSetType} from "@lodestar/state-transition";
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
      const pubkey = pubkeyCache.get(signatureSet.index);
      if (!pubkey) {
        throw Error(`Missing pubkey for validator index ${signatureSet.index}`);
      }
      return pubkey;
    }

    case SignatureSetType.aggregate: {
      const timer = metrics?.blsThreadPool.pubkeysAggregationMainThreadDuration.startTimer();
      const pubkeys = signatureSet.indices.map((i) => {
        const pubkey = pubkeyCache.get(i);
        if (!pubkey) {
          throw Error(`Missing pubkey for validator index ${i}`);
        }
        return pubkey;
      });
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
