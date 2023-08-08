import {
  asyncVerifyMultipleAggregateSignatures,
  asyncVerify,
  verifyMultipleAggregateSignatures,
  verify,
} from "@chainsafe/blst-ts";
import {Logger} from "@lodestar/utils";
import {DeserializedSignatureSet, SerializedSignatureSet} from "./multithread/types.js";

const MIN_SET_COUNT_TO_BATCH = 2;

/**
 * Verify signatures sets with batch verification or regular core verify depending on the set count.
 * Abstracted in a separate file to be consumed by the threaded pool and the main thread implementation.
 */
export function verifySignatureSetsMaybeBatch(sets: SerializedSignatureSet[]): boolean {
  if (sets.length >= MIN_SET_COUNT_TO_BATCH) {
    return verifyMultipleAggregateSignatures(sets);
  }

  // .every on an empty array returns true
  if (sets.length === 0) {
    throw Error("Empty signature set");
  }

  // If too few signature sets verify them without batching
  return sets.every((set) => verify(set.message, set.publicKey, set.signature));
}

export async function asyncVerifySignatureSetsMaybeBatch(
  logger: Logger,
  sets: DeserializedSignatureSet[]
): Promise<boolean> {
  if (sets.length >= MIN_SET_COUNT_TO_BATCH) {
    logger.debug(`Attempting batch verification of ${sets.length} signature sets`);
    return asyncVerifyMultipleAggregateSignatures(sets);
  }

  // .every on an empty array returns true
  if (sets.length === 0) {
    throw Error("Empty signature set");
  }

  // If too few signature sets verify them without batching
  logger.debug(`Attempting individual verification of ${sets.length} signature sets`);
  const verifications = await Promise.all(
    sets.map((set) => asyncVerify(set.message, set.publicKey, set.signature).catch(() => false))
  );

  return verifications.every((v) => v);
}
