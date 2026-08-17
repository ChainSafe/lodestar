import {
  BLS_VERIFIER_MAX_BATCH_SIZE,
  BLS_VERIFIER_MAX_SAME_MESSAGE_BATCH_SIZE,
  BLS_VERIFIER_SET_TYPE,
  type BlsSignatureSet,
  verifySignatureSets,
} from "@chainsafe/lodestar-z/bls-verifier";
import {ISignatureSet, SignatureSetType} from "@lodestar/state-transition";
import {SameMessageSignatureSet} from "./interface.js";

export function toBlsSignatureSet(signatureSet: ISignatureSet): BlsSignatureSet {
  switch (signatureSet.type) {
    case SignatureSetType.single:
      return {
        type: BLS_VERIFIER_SET_TYPE.single,
        pubkey: signatureSet.pubkey,
        message: signatureSet.signingRoot,
        signature: signatureSet.signature,
      };

    case SignatureSetType.indexed:
      return {
        type: BLS_VERIFIER_SET_TYPE.indexed,
        index: signatureSet.index,
        message: signatureSet.signingRoot,
        signature: signatureSet.signature,
      };

    case SignatureSetType.aggregate: {
      const indices = new Uint32Array(signatureSet.indices.length);
      for (const [i, index] of signatureSet.indices.entries()) {
        if (!Number.isInteger(index) || index < 0 || index > 0xffffffff) {
          throw new RangeError(`Invalid validator index ${index}`);
        }
        indices[i] = index;
      }

      return {
        type: BLS_VERIFIER_SET_TYPE.aggregate,
        indices,
        message: signatureSet.signingRoot,
        signature: signatureSet.signature,
      };
    }

    default:
      throw Error("Unknown signature set type");
  }
}

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
