import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {unshuffleList} from "../../../src";
import {BenchmarkRunner} from "../runner";

//          Lightouse  Lodestar
// 512      254.04 us  1.6034 ms (x6)
// 16384    6.2046 ms  18.272 ms (x3)
// 4000000  1.5617 s   4.9690 s  (x3)

// eslint-disable-next-line @typescript-eslint/no-floating-promises
(async function () {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const config = {params: {SHUFFLE_ROUND_COUNT: 90}} as IBeaconConfig;
  const seed = new Uint8Array([42, 32]);

  const runner = new BenchmarkRunner("shuffle list", {
    runs: 512,
    maxMs: 30 * 1000,
  });

  for (const listSize of [512, 16384, 4000000]) {
    await runner.run({
      id: `list size ${listSize}`,
      before: () => {
        const input: number[] = [];
        for (let i = 0; i < listSize; i++) {
          input[i] = i;
        }
        return input;
      },
      run: (input) => {
        unshuffleList(config, input, seed);
      },
    });
  }
})();
