import assert from "assert";

/**
 * Pads byte array with zeroes on left side up to desired length.
 * Throws if source is larger than desired result.
 * @param source
 * @param length
 */
export function padLeft(source: Buffer, length: number): Buffer {
  assert(source.length <= length, "Given array must be smaller or equal to desired array size");
  const result = Buffer.alloc(length, 0);
  source.copy(result, length - source.length);
  return result;
}