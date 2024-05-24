import {
  asyncVerify,
  asyncVerifyMultipleAggregateSignatures,
  verify,
  verifyMultipleAggregateSignatures,
} from "@chainsafe/blst";
import {WorkRequestSet} from "./types.js";

const MIN_SET_COUNT_TO_BATCH = 2;

/**
 * Verify signatures sets with batch verification or regular core verify depending on the set count.
 * Abstracted in a separate file to be consumed by the threaded pool and the main thread implementation.
 */
export function verifySets(sets: WorkRequestSet[]): boolean {
  try {
    if (sets.length >= MIN_SET_COUNT_TO_BATCH) {
      return verifyMultipleAggregateSignatures(sets);
    }

    // .every on an empty array returns true
    if (sets.length === 0) {
      throw Error("Empty signature set");
    }

    // If too few signature sets verify them without batching
    return sets.every(({message, publicKey, signature}) => verify(message, publicKey, signature));
  } catch (_) {
    // A signature could be malformed, in that case fromBytes throws error
    // blst-ts `verifyMultipleSignatures` is also a fallible operation if mul_n_aggregate fails
    // see https://github.com/ChainSafe/blst-ts/blob/b1ba6333f664b08e5c50b2b0d18c4f079203962b/src/lib.ts#L291
    return false;
  }
}

export async function asyncVerifySets(sets: WorkRequestSet[]): Promise<boolean> {
  try {
    if (sets.length >= MIN_SET_COUNT_TO_BATCH) {
      return await asyncVerifyMultipleAggregateSignatures(sets);
    }

    // .every on an empty array returns true
    if (sets.length === 0) {
      throw Error("Empty signature sets");
    }

    const promises = await Promise.all(
      sets.map(({message, publicKey, signature}) => asyncVerify(message, publicKey, signature))
    );
    // If too few signature sets verify them without batching
    return promises.every((isValid) => isValid);
  } catch (_) {
    // A signature could be malformed, in that case fromBytes throws error
    // blst-ts `verifyMultipleSignatures` is also a fallible operation if mul_n_aggregate fails
    // see https://github.com/ChainSafe/blst-ts/blob/b1ba6333f664b08e5c50b2b0d18c4f079203962b/src/lib.ts#L291
    return false;
  }
}
