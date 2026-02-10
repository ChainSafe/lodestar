import crypto from "node:crypto";
import {bench, describe} from "@chainsafe/benchmark";
import {byteArrayEquals} from "@lodestar/utils";
import {generateState} from "../../utils/state.js";
import {generateValidators} from "../../utils/validator.js";

/**
 * Original loop-based implementation from @chainsafe/ssz for benchmark comparison.
 * This is what byteArrayEquals used to be before switching to Buffer.compare.
 */
function byteArrayEqualsLoop(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Compare loop-based byteArrayEquals (original @chainsafe/ssz implementation)
 * vs hybrid byteArrayEquals (new @lodestar/utils implementation).
 *
 * Node v24.13.0 benchmark results:
 *
 * For small arrays (<=48 bytes), loop is faster due to V8 JIT optimizations:
 *   - 32 bytes: Loop 14.7 ns/op vs Buffer.compare 49.7 ns/op (Loop 3.4x faster)
 *
 * For medium arrays, loop is still competitive:
 *   - 48 bytes: Loop 36 ns/op vs Buffer.compare 56 ns/op (Loop 1.5x faster)
 *
 * For larger arrays, Buffer.compare is faster due to native code:
 *   - 96 bytes:    Loop 130 ns/op vs Buffer.compare 50 ns/op (Buffer 2.6x faster)
 *   - 1024 bytes:  Loop 940 ns/op vs Buffer.compare 55 ns/op (Buffer 17x faster)
 *   - 16384 bytes: Loop 14.8 μs/op vs Buffer.compare 270 ns/op (Buffer 55x faster)
 *
 * The @lodestar/utils implementation uses a hybrid approach:
 *   - Loop for <=48 bytes (common case: roots, pubkeys)
 *   - Buffer.compare for >48 bytes (signatures, large data)
 */
describe.skip("compare Uint8Array using loop-based vs Buffer.compare-based byteArrayEquals", () => {
  const numValidator = 1_000_000;
  const validators = generateValidators(numValidator);
  const state = generateState({validators: validators});
  const stateBytes = state.serialize();

  const lengths = [32, 1024, 16384, stateBytes.length];
  describe("same bytes", () => {
    for (const length of lengths) {
      const runsFactor = length > 16384 ? 100 : 1000;
      const bytes = stateBytes.subarray(0, length);
      const bytes2 = bytes.slice();
      bench({
        id: `byteArrayEqualsLoop ${length}`,
        fn: () => {
          for (let i = 0; i < runsFactor; i++) {
            byteArrayEqualsLoop(bytes, bytes2);
          }
        },
        runsFactor,
      });

      bench({
        id: `byteArrayEquals ${length}`,
        fn: () => {
          for (let i = 0; i < runsFactor; i++) {
            byteArrayEquals(bytes, bytes2);
          }
        },
        runsFactor,
      });
    }
  });

  describe("different at the last byte", () => {
    for (const length of lengths) {
      const runsFactor = length > 16384 ? 100 : 1000;
      const bytes = stateBytes.subarray(0, length);
      const bytes2 = bytes.slice();
      bytes2[bytes2.length - 1] = (bytes2.at(-1) as number) + 1;
      bench({
        id: `byteArrayEqualsLoop ${length} - diff last byte`,
        fn: () => {
          for (let i = 0; i < runsFactor; i++) {
            byteArrayEqualsLoop(bytes, bytes2);
          }
        },
        runsFactor,
      });

      bench({
        id: `byteArrayEquals ${length} - diff last byte`,
        fn: () => {
          for (let i = 0; i < runsFactor; i++) {
            byteArrayEquals(bytes, bytes2);
          }
        },
        runsFactor,
      });
    }
  });

  describe("totally different", () => {
    for (const length of lengths) {
      const runsFactor = length > 16384 ? 100 : 1000;
      const bytes = crypto.randomBytes(length);
      const bytes2 = crypto.randomBytes(length);

      bench({
        id: `byteArrayEqualsLoop ${length} - random bytes`,
        fn: () => {
          for (let i = 0; i < runsFactor; i++) {
            byteArrayEqualsLoop(bytes, bytes2);
          }
        },
        runsFactor,
      });

      bench({
        id: `byteArrayEquals ${length} - random bytes`,
        fn: () => {
          for (let i = 0; i < runsFactor; i++) {
            byteArrayEquals(bytes, bytes2);
          }
        },
        runsFactor,
      });
    }
  });
});
