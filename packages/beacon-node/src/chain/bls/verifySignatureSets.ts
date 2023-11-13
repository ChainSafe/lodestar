import {
  SignatureSet,
  asyncVerifyMultipleAggregateSignatures,
  asyncVerify,
  verifyMultipleAggregateSignatures,
  verify,
} from "@chainsafe/blst-ts";

const MIN_SET_COUNT_TO_BATCH = 2;

/**
 * Verify signatures sets with batch verification or regular core verify depending on the set count.
 * Abstracted in a separate file to be consumed by the threaded pool and the main thread implementation.
 */
export function verifySignatureSets(sets: SignatureSet[]): boolean {
  try {
    if (sets.length >= MIN_SET_COUNT_TO_BATCH) {
      return verifyMultipleAggregateSignatures(sets);
    }

    // .every on an empty array returns true
    if (sets.length === 0) {
      throw Error("Empty signature set");
    }

    // If too few signature sets verify them without batching
    return sets.every((set) => verify(set.message, set.publicKey, set.signature));
  } catch {
    // A signature could be malformed, in that case fromBytes throws error
    // blst-ts `verifyMultipleSignatures` is also a fallible operation if mul_n_aggregate fails
    // see https://github.com/ChainSafe/blst-ts/blob/b1ba6333f664b08e5c50b2b0d18c4f079203962b/src/lib.ts#L291
    return false;
  }
}

export async function asyncVerifySignatureSets(sets: SignatureSet[]): Promise<boolean> {
  try {
    if (sets.length >= MIN_SET_COUNT_TO_BATCH) {
      return await asyncVerifyMultipleAggregateSignatures(sets);
    }

    // .every on an empty array returns true
    if (sets.length === 0) {
      throw Error("Empty signature set");
    }

    // If too few signature sets verify them without batching
    const verifications = await Promise.all(
      sets.map((set) => asyncVerify(set.message, set.publicKey, set.signature).catch(() => false))
    );

    return verifications.every((v) => v);
  } catch {
    return false;
  }
}
