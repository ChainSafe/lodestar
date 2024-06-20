import {
  Signature,
  SignatureSet,
  verify,
  verifyAsync,
  verifyMultipleAggregateSignatures,
  verifyMultipleAggregateSignaturesAsync,
} from "@chainsafe/blst";
import {WorkRequestSet} from "./types.js";

const MIN_SET_COUNT_TO_BATCH = 2;

function deserializeSet(set: WorkRequestSet): SignatureSet {
  return {
    msg: set.message,
    pk: set.publicKey,
    sig: set.signature instanceof Uint8Array ? Signature.deserialize(set.signature) : set.signature,
  };
}

/**
 * Verify signatures sets with batch verification or regular core verify depending on the set count.
 * Abstracted in a separate file to be consumed by the threaded pool and the main thread implementation.
 */
export function verifySets(sets: WorkRequestSet[]): boolean {
  try {
    if (sets.length >= MIN_SET_COUNT_TO_BATCH) {
      return verifyMultipleAggregateSignatures(sets.map(deserializeSet));
    }

    // .every on an empty array returns true
    if (sets.length === 0) {
      throw Error("Empty signature set");
    }

    // If too few signature sets verify them without batching
    return sets.map(deserializeSet).every(({msg, pk, sig}) => verify(msg, pk, sig));
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
      return await verifyMultipleAggregateSignaturesAsync(sets.map(deserializeSet));
    }

    // .every on an empty array returns true
    if (sets.length === 0) {
      throw Error("Empty signature sets");
    }

    const promises = await Promise.all(sets.map(deserializeSet).map(({msg, pk, sig}) => verifyAsync(msg, pk, sig)));
    // If too few signature sets verify them without batching
    return promises.every((isValid) => isValid);
  } catch (_) {
    // A signature could be malformed, in that case fromBytes throws error
    // blst-ts `verifyMultipleSignatures` is also a fallible operation if mul_n_aggregate fails
    // see https://github.com/ChainSafe/blst-ts/blob/b1ba6333f664b08e5c50b2b0d18c4f079203962b/src/lib.ts#L291
    return false;
  }
}
