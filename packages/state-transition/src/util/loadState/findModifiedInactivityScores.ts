import {byteArrayEquals} from "@lodestar/utils";

// UintNum64 = 8 bytes
export const INACTIVITY_SCORE_SIZE = 8;

/**
 * As monitored on mainnet, inactivityScores are not changed much and they are mostly 0
 * Using byteArrayEquals is the optimal way as noted in `./findModifiedValidators.ts`
 * @returns output parameter modifiedValidators: validator indices that are modified
 */
export function findModifiedInactivityScores(
  inactivityScoresBytes: Uint8Array,
  inactivityScoresBytes2: Uint8Array,
  modifiedValidators: number[],
  validatorOffset = 0
): void {
  if (inactivityScoresBytes.length !== inactivityScoresBytes2.length) {
    throw new Error(
      "inactivityScoresBytes.length !== inactivityScoresBytes2.length " +
        inactivityScoresBytes.length +
        " vs " +
        inactivityScoresBytes2.length
    );
  }

  if (byteArrayEquals(inactivityScoresBytes, inactivityScoresBytes2)) {
    return;
  }

  if (inactivityScoresBytes.length === INACTIVITY_SCORE_SIZE) {
    modifiedValidators.push(validatorOffset);
    return;
  }

  const numValidator = Math.floor(inactivityScoresBytes.length / INACTIVITY_SCORE_SIZE);
  const halfValidator = Math.floor(numValidator / 2);
  findModifiedInactivityScores(
    inactivityScoresBytes.subarray(0, halfValidator * INACTIVITY_SCORE_SIZE),
    inactivityScoresBytes2.subarray(0, halfValidator * INACTIVITY_SCORE_SIZE),
    modifiedValidators,
    validatorOffset
  );
  findModifiedInactivityScores(
    inactivityScoresBytes.subarray(halfValidator * INACTIVITY_SCORE_SIZE),
    inactivityScoresBytes2.subarray(halfValidator * INACTIVITY_SCORE_SIZE),
    modifiedValidators,
    validatorOffset + halfValidator
  );
}
