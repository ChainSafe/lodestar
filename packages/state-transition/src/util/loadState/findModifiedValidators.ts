import {VALIDATOR_BYTES_SIZE} from "../sszBytes.js";

/**
 * Find modified validators by comparing two validators bytes using Buffer.compare() recursively
 * - As noted in packages/state-transition/test/perf/util/loadState/findModifiedValidators.test.ts, serializing validators and compare Uint8Array is the fastest way
 * - The performance is quite stable and can afford a lot of difference in validators (the benchmark tested up to 10k but it's not likely we have that difference in mainnet)
 * - Also packages/state-transition/test/perf/misc/byteArrayEquals.test.ts shows that Buffer.compare() is very efficient for large Uint8Array
 *
 * @returns output parameter modifiedValidators: validator indices that are modified
 */
export function findModifiedValidators(
  validatorsBytes: Uint8Array,
  validatorsBytes2: Uint8Array,
  modifiedValidators: number[],
  validatorOffset = 0
): void {
  if (validatorsBytes.length !== validatorsBytes2.length) {
    throw new Error(
      "validatorsBytes.length !== validatorsBytes2.length " + validatorsBytes.length + " vs " + validatorsBytes2.length
    );
  }

  if (Buffer.compare(validatorsBytes, validatorsBytes2) === 0) {
    return;
  }

  if (validatorsBytes.length === VALIDATOR_BYTES_SIZE) {
    modifiedValidators.push(validatorOffset);
    return;
  }

  const numValidator = Math.floor(validatorsBytes.length / VALIDATOR_BYTES_SIZE);
  const halfValidator = Math.floor(numValidator / 2);
  findModifiedValidators(
    validatorsBytes.subarray(0, halfValidator * VALIDATOR_BYTES_SIZE),
    validatorsBytes2.subarray(0, halfValidator * VALIDATOR_BYTES_SIZE),
    modifiedValidators,
    validatorOffset
  );
  findModifiedValidators(
    validatorsBytes.subarray(halfValidator * VALIDATOR_BYTES_SIZE),
    validatorsBytes2.subarray(halfValidator * VALIDATOR_BYTES_SIZE),
    modifiedValidators,
    validatorOffset + halfValidator
  );
}
