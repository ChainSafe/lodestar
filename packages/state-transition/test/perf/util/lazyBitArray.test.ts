import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {buildLazyBitArray} from "../../../src/util/lazyBitArray.js";

/**
 * As of Aug 2022, LaziBitArray vs boolean[]:
 * - ~1.5x slower to read
 * - ~5x slower to write
 * - ~60x faster to clone
 */
describe("LazyBitArray vs. boolean[]", function () {
  setBenchOpts({noThreshold: true});

  const length = 400_000;

  itBench({
    id: `random read boolean[] ${length} bits`,
    beforeEach: () => Array.from({length}, () => true),
    fn: (arr) => {
      for (let i = 0; i < length; i++) {
        arr[i];
      }
    },
    runsFactor: 1000,
  });

  itBench({
    id: `random read LazyBitArray ${length} bits`,
    beforeEach: () => {
      const bits = Array.from({length}, () => true);
      return buildLazyBitArray(bits);
    },
    fn: (arr) => {
      for (let i = 0; i < length; i++) {
        arr.get(i);
      }
    },
    runsFactor: 1000,
  });

  itBench({
    id: `random write boolean[] ${length} bits`,
    beforeEach: () => Array.from({length}, () => false),
    fn: (arr) => {
      for (let i = 0; i < length; i++) {
        arr[i] = true;
      }
    },
    runsFactor: 1000,
  });

  itBench({
    id: `random write LazyBitArray ${length} bits`,
    beforeEach: () => buildLazyBitArray(Array.from({length}, () => false)),
    fn: (arr) => {
      for (let i = 0; i < length; i++) {
        arr.set(i, true);
      }
    },
    runsFactor: 1000,
  });

  itBench({
    id: `clone boolean ${length} bits`,
    beforeEach: () => Array.from({length}, () => true),
    fn: (arr) => {
      arr.slice();
    },
    runsFactor: 1000,
  });

  itBench({
    id: `clone LazyBitArray ${length} bits`,
    beforeEach: () => buildLazyBitArray(Array.from({length}, () => true)),
    fn: (arr) => {
      arr.clone(true);
    },
    runsFactor: 1000,
  });
});
