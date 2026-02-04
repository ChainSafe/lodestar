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
 * vs Buffer.compare-based byteArrayEquals (new @lodestar/utils implementation).
 *
 * The longer the array, the better performance Buffer.compare provides:
 *   - with 32 bytes, Buffer.compare is ~1.5x faster
 *    ✔ byteArrayEqualsLoop 32                                           1.004480e+7 ops/s    99.55400 ns/op
 *    ✔ byteArrayEquals 32                                               1.553495e+7 ops/s    64.37100 ns/op
 *
 *   - with 1024 bytes, Buffer.compare is ~22x faster
 *    ✔ byteArrayEqualsLoop 1024                                            379239.7 ops/s    2.636855 us/op
 *    ✔ byteArrayEquals 1024                                                 8269999 ops/s    120.9190 ns/op
 *
 *   - with 16384 bytes, Buffer.compare is ~41x faster
 *    ✔ byteArrayEqualsLoop 16384                                           23808.76 ops/s    42.00135 us/op
 *    ✔ byteArrayEquals 16384                                               975058.0 ops/s    1.025580 us/op
 *
 *   - with 123687377 bytes (full state), Buffer.compare is ~38x faster
 *    ✔ byteArrayEqualsLoop 123687377                                       3.077884 ops/s    324.8985 ms/op
 *    ✔ byteArrayEquals 123687377                                           114.7834 ops/s    8.712061 ms/op
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
