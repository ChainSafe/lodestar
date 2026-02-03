import {Root} from "@lodestar/types";

/**
 * Compare two byte arrays for equality using Buffer.compare for better performance.
 * Buffer.compare uses native code and is significantly faster than manual iteration:
 * - 32 bytes: ~2x faster
 * - 1024 bytes: ~22x faster
 * - Large arrays (100MB+): ~38x faster
 *
 * See packages/state-transition/test/perf/misc/byteArrayEquals.test.ts for benchmarks.
 */
export function byteArrayEquals(a: Uint8Array | Root, b: Uint8Array | Root): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return Buffer.compare(a, b) === 0;
}
