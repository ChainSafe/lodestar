import type {PublicKey} from "@chainsafe/bls/types";
import bls from "@chainsafe/bls";
import {ISignatureSet, SignatureSetType} from "@lodestar/state-transition";
import {Metrics} from "../../metrics/metrics.js";

export function getAggregatedPubkey(signatureSet: ISignatureSet, metrics: Metrics | null = null): PublicKey {
  switch (signatureSet.type) {
    case SignatureSetType.single:
      return signatureSet.pubkey;

    case SignatureSetType.aggregate: {
      const timer = metrics?.blsThreadPool.pubkeysAggregationMainThreadDuration.startTimer();
      const pubkeys = bls.PublicKey.aggregate(signatureSet.pubkeys);
      timer?.();
      return pubkeys;
    }

    default:
      throw Error("Unknown signature set type");
  }
}

export function getAggregatedPubkeysCount(signatureSets: ISignatureSet[]): number {
  let pubkeysConut = 0;
  for (const set of signatureSets) {
    if (set.type === SignatureSetType.aggregate) {
      pubkeysConut += set.pubkeys.length;
    }
  }
  return pubkeysConut;
}
