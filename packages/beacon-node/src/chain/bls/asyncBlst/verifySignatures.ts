import {verify, verifyMultipleAggregateSignaturesAsync} from "@chainsafe/blst";
import {SignatureSet} from "./types.js";

const MIN_SET_COUNT_TO_BATCH = 2;

/**
 * Verify signatures sets with batch verification or regular core verify depending on the set count.
 * Abstracted in a separate file to be consumed by the threaded pool and the main thread implementation.
 */
export async function verifySignatureSetsMaybeBatch(sets: SignatureSet[]): Promise<boolean> {
  try {
    if (sets.length >= MIN_SET_COUNT_TO_BATCH) {
      const ssets = sets.map((s) => ({
        pk: s.publicKey,
        msg: s.message,
        sig: s.signature,
      }));
      const res = await verifyMultipleAggregateSignaturesAsync(ssets);
      return res;
    }

    // .every on an empty array returns true
    if (sets.length === 0) {
      throw Error("Empty signature set");
    }

    // If too few signature sets verify them without batching
    for (const set of sets) {
      if (!verify(set.message, set.publicKey, set.signature)) {
        return false;
      }
    }
    return true;
  } catch (_) {
    // A signature could be malformed, in that case fromBytes throws error
    // blst-ts `verifyMultipleSignatures` is also a fallible operation if mul_n_aggregate fails
    // see https://github.com/ChainSafe/blst-ts/blob/b1ba6333f664b08e5c50b2b0d18c4f079203962b/src/lib.ts#L291
    return false;
  }
}
