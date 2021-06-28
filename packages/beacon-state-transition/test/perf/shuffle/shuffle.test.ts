import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {unshuffleList} from "../../../src";

//          Lightouse  Lodestar
// 512      254.04 us  1.6034 ms (x6)
// 16384    6.2046 ms  18.272 ms (x3)
// 4000000  1.5617 s   4.9690 s  (x3)

describe("shuffle list", () => {
  setBenchOpts({
    maxMs: 30 * 1000,
    minMs: 10 * 1000,
    runs: 512,
  });

  // eslint-disable-next-line @typescript-eslint/naming-convention
  const seed = new Uint8Array([42, 32]);

  for (const listSize of [
    512,
    16384,
    250000,
    // Don't run 4_000_000 since it's very slow and not testnet has gotten there yet
    // 4e6,
  ]) {
    const input: number[] = [];
    for (let i = 0; i < listSize; i++) {
      input[i] = i;
    }

    itBench(`shuffle list - ${listSize} els`, () => {
      unshuffleList(input, seed);
    });
  }
});
