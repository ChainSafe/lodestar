import {
  PublicKey,
  Signature,
  verify,
  verifyMultipleAggregateSignatures,
  verifyMultipleAggregateSignaturesAsync,
} from "@chainsafe/blst";

const MIN_SET_COUNT_TO_BATCH = 2;

export type SignatureSetDeserialized = {
  publicKey: PublicKey;
  message: Uint8Array;
  signature: Uint8Array;
};

/**
 * Verify signatures sets with batch verification or regular core verify depending on the set count.
 * Abstracted in a separate file to be consumed by the threaded pool and the main thread implementation.
 */
export function verifySignatureSetsMaybeBatch(sets: SignatureSetDeserialized[]): boolean {
  try {
    if (sets.length >= MIN_SET_COUNT_TO_BATCH) {
      return verifyMultipleAggregateSignatures(
        sets.map((s) => ({
          pk: s.publicKey,
          msg: s.message,
          // true = validate signature
          sig: Signature.fromBytes(s.signature, true),
        }))
      );
    }

    // .every on an empty array returns true
    if (sets.length === 0) {
      throw Error("Empty signature set");
    }

    // If too few signature sets verify them without batching
    return sets.every((set) => {
      // true = validate signature
      const sig = Signature.fromBytes(set.signature, true);
      return verify(set.message, set.publicKey, sig);
    });
  } catch (_) {
    // A signature could be malformed, in that case fromBytes throws error
    // blst-ts `verifyMultipleSignatures` is also a fallible operation if mul_n_aggregate fails
    // see https://github.com/ChainSafe/blst-ts/blob/b1ba6333f664b08e5c50b2b0d18c4f079203962b/src/lib.ts#L291
    return false;
  }
}

export async function verifySignatureSetsMaybeBatchAsync(sets: SignatureSetDeserialized[]): Promise<boolean> {
  try {
    if (sets.length >= MIN_SET_COUNT_TO_BATCH) {
      return await verifyMultipleAggregateSignaturesAsync(
        sets.map((s) => ({
          pk: s.publicKey,
          msg: s.message,
          // true = validate signature
          sig: Signature.fromBytes(s.signature, true),
        }))
      );
    }

    // .every on an empty array returns true
    if (sets.length === 0) {
      throw Error("Empty signature set");
    }

    // If too few signature sets verify them without batching
    return sets.every((set) => {
      // true = validate signature
      const sig = Signature.fromBytes(set.signature, true);
      return verify(set.message, set.publicKey, sig);
    });
  } catch (_) {
    // A signature could be malformed, in that case fromBytes throws error
    // blst-ts `verifyMultipleSignatures` is also a fallible operation if mul_n_aggregate fails
    // see https://github.com/ChainSafe/blst-ts/blob/b1ba6333f664b08e5c50b2b0d18c4f079203962b/src/lib.ts#L291
    return false;
  }
}
