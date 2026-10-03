import {
  BLS_VERIFIER_MAX_BATCH_SIZE,
  BLS_VERIFIER_MAX_SAME_MESSAGE_BATCH_SIZE,
  verifySignatureSets,
} from "@chainsafe/lodestar-z/bls-verifier";
import {ISignatureSet, SignatureSetType, toBlsSignatureSet} from "@lodestar/state-transition";
import {SameMessageSignatureSet} from "./interface.js";

export function verifySignatureSetsInBatches(signatureSets: ISignatureSet[]): boolean {
  if (signatureSets.length === 0) {
    return false;
  }

  for (let start = 0; start < signatureSets.length; start += BLS_VERIFIER_MAX_BATCH_SIZE) {
    const sets = signatureSets.slice(start, start + BLS_VERIFIER_MAX_BATCH_SIZE).map(toBlsSignatureSet);
    if (!verifySignatureSets(sets)) {
      return false;
    }
  }

  return true;
}

export function chunkSameMessageSignatureSets(sets: SameMessageSignatureSet[]): SameMessageSignatureSet[][] {
  const chunks: SameMessageSignatureSet[][] = [];
  for (let start = 0; start < sets.length; start += BLS_VERIFIER_MAX_SAME_MESSAGE_BATCH_SIZE) {
    chunks.push(sets.slice(start, start + BLS_VERIFIER_MAX_SAME_MESSAGE_BATCH_SIZE));
  }
  return chunks;
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
