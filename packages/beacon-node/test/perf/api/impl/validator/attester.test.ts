import {beforeAll, bench, describe} from "@chainsafe/benchmark";
import {BeaconStateView} from "@lodestar/state-transition";
import {generatePerfTestCachedStatePhase0, numValidators} from "@lodestar/state-transition/test-utils";
import {getPubkeysForIndices} from "../../../../../src/api/impl/validator/utils.js";
import {linspace} from "../../../../../src/util/numpy.js";

// Using state.validators.persistent is the fastest way of retrieving pubkeys by far
// Benchmark data from Fri Aug 21 2026 - 11th Gen Intel(R) Core(TM) i5-1135G7 @ 2.40GHz
//
// ✓ getPubkeys - native cache - req 1 vs - 250000 vc                    1831502 ops/s    546.0000 ns/op        -     280009 runs  0.386 s
// ✓ getPubkeys - native cache - req 100 vs - 250000 vc                  28639.34 ops/s    34.91700 us/op        -      10880 runs  0.581 s
// ✓ getPubkeys - native cache - req 1000 vs - 250000 vc                 1638.520 ops/s    610.3070 us/op        -        495 runs  0.769 s
// ✓ getPubkeys - validatorsArr - req 1 vs - 250000 vc                    4464286 ops/s    224.0000 ns/op        -     944505 runs  0.983 s
// ✓ getPubkeys - validatorsArr - req 100 vs - 250000 vc                 218436.0 ops/s    4.578000 us/op        -      56100 runs  0.317 s
// ✓ getPubkeys - validatorsArr - req 1000 vs - 250000 vc                22047.80 ops/s    45.35600 us/op        -       5503 runs  0.304 s
// ((DEPRECATED)) ========================================================
// ✓ getPubkeys - persistent - req 1 vs - 200000 vc                       1579779 ops/s    633.0000 ns/op        -    2278954 runs   2.11 s
// ✓ getPubkeys - persistent - req 100 vs - 200000 vc                    395100.8 ops/s    2.531000 us/op        -     714562 runs   2.05 s
// ✓ getPubkeys - persistent - req 1000 vs - 200000 vc                   56593.10 ops/s    17.67000 us/op        -     111477 runs   2.00 s

describe("api / impl / validator", () => {
  let state: ReturnType<typeof generatePerfTestCachedStatePhase0>;

  beforeAll(() => {
    state = generatePerfTestCachedStatePhase0();
  });

  const reqCounts = process.env.CI ? [1000] : [1, 100, 1000];

  for (const reqCount of reqCounts) {
    bench({
      id: `getPubkeys - native cache - req ${reqCount} vs - ${numValidators} vc`,
      noThreshold: true,
      fn: () => {
        for (let i = 0; i < reqCount; i++) {
          state.epochCtx.pubkeyCache.getPubkeyBytesOrThrow(i);
        }
      },
    });
  }

  // 7.17 ms / op (1000)
  for (const reqCount of reqCounts) {
    bench({
      id: `getPubkeys - validatorsArr - req ${reqCount} vs - ${numValidators} vc`,
      // Only track regressions for 1000 in CI to ensure performance does not degrade
      noThreshold: reqCount < 1000,
      fn: () => {
        const indexes = linspace(0, reqCount - 1);
        getPubkeysForIndices(new BeaconStateView(state), indexes);
      },
    });
  }
});
