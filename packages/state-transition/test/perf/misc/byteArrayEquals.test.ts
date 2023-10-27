import crypto from "node:crypto";
import {itBench} from "@dapplion/benchmark";
import {byteArrayEquals} from "@chainsafe/ssz";
import {generateState} from "../../utils/state.js";
import {generateValidators} from "../../utils/validator.js";

/**
 *   compare Uint8Array, the longer the array, the better performance Buffer.compare() is
 *   - with 32 bytes, Buffer.compare() is 1.5x faster (rootEquals.test.ts showed > 2x faster)
 *    ✔ byteArrayEquals 32                                               1.004480e+7 ops/s    99.55400 ns/op        -      19199 runs   2.08 s
 *    ✔ Buffer.compare 32                                                1.553495e+7 ops/s    64.37100 ns/op        -       3634 runs  0.303 s
 *
 *   - with 1024 bytes, Buffer.compare() is 21.8x faster
 *    ✔ byteArrayEquals 1024                                                379239.7 ops/s    2.636855 us/op        -        117 runs  0.811 s
 *    ✔ Buffer.compare 1024                                                  8269999 ops/s    120.9190 ns/op        -       3330 runs  0.525 s
 *
 *   - with 16384 bytes, Buffer.compare() is 41x faster
 *    ✔ byteArrayEquals 16384                                               23808.76 ops/s    42.00135 us/op        -         13 runs   1.05 s
 *    ✔ Buffer.compare 16384                                                975058.0 ops/s    1.025580 us/op        -        297 runs  0.806 s
 *
 *   - with 123687377 bytes, Buffer.compare() is 38x faster
 *    ✔ byteArrayEquals 123687377                                           3.077884 ops/s    324.8985 ms/op        -          1 runs   64.5 s
 *    ✔ Buffer.compare 123687377                                            114.7834 ops/s    8.712061 ms/op        -         13 runs   12.1 s
 */
describe("compare Uint8Array using byteArrayEquals() vs Buffer.compare()", () => {
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
      itBench({
        id: `byteArrayEquals ${length}`,
        fn: () => {
          for (let i = 0; i < runsFactor; i++) {
            byteArrayEquals(bytes, bytes2);
          }
        },
        runsFactor,
      });

      itBench({
        id: `Buffer.compare ${length}`,
        fn: () => {
          for (let i = 0; i < runsFactor; i++) {
            Buffer.compare(bytes, bytes2);
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
      bytes2[bytes2.length - 1] = bytes2[bytes2.length - 1] + 1;
      itBench({
        id: `byteArrayEquals ${length} - diff last byte`,
        fn: () => {
          for (let i = 0; i < runsFactor; i++) {
            byteArrayEquals(bytes, bytes2);
          }
        },
        runsFactor,
      });

      itBench({
        id: `Buffer.compare ${length} - diff last byte`,
        fn: () => {
          for (let i = 0; i < runsFactor; i++) {
            Buffer.compare(bytes, bytes2);
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

      itBench({
        id: `byteArrayEquals ${length} - random bytes`,
        fn: () => {
          for (let i = 0; i < runsFactor; i++) {
            byteArrayEquals(bytes, bytes2);
          }
        },
        runsFactor,
      });

      itBench({
        id: `Buffer.compare ${length} - random bytes`,
        fn: () => {
          for (let i = 0; i < runsFactor; i++) {
            Buffer.compare(bytes, bytes2);
          }
        },
        runsFactor,
      });
    }
  });
});
