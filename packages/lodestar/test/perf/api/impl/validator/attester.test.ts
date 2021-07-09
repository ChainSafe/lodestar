import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {PointFormat} from "@chainsafe/bls";
import {
  generatePerfTestCachedStatePhase0,
  numValidators,
} from "@chainsafe/lodestar-beacon-state-transition/test/perf/util";

// Using state.validators.persistent is the fastest way of retrieving pubkeys by far
// Benchmark data from Wed Jun 30 2021 - Intel(R) Core(TM) i5-8250U CPU @ 1.60GHz
//
// ✓ getPubkeys - index2pubkey - req 1 vs - 200000 vc                    836120.4 ops/s    1.196000 us/op        -    1224786 runs   2.07 s
// ✓ getPubkeys - index2pubkey - req 100 vs - 200000 vc                  10347.15 ops/s    96.64500 us/op        -      20602 runs   2.00 s
// ✓ getPubkeys - index2pubkey - req 1000 vs - 200000 vc                 1248.985 ops/s    800.6500 us/op        -       2518 runs   2.02 s
// ✓ getPubkeys - validatorsArr - req 1 vs - 200000 vc                   1109878 ops/s    901.0000 ns/op        -    1714328 runs   2.09 s
// ✓ getPubkeys - validatorsArr - req 100 vs - 200000 vc                19937.00 ops/s    50.15800 us/op        -      39548 runs   2.00 s
// ✓ getPubkeys - validatorsArr - req 1000 vs - 200000 vc               2475.542 ops/s    403.9520 us/op        -       4947 runs   2.00 s
// ✓ getPubkeys - persistent - req 1 vs - 200000 vc                       1579779 ops/s    633.0000 ns/op        -    2278954 runs   2.11 s
// ✓ getPubkeys - persistent - req 100 vs - 200000 vc                    395100.8 ops/s    2.531000 us/op        -     714562 runs   2.05 s
// ✓ getPubkeys - persistent - req 1000 vs - 200000 vc                   56593.10 ops/s    17.67000 us/op        -     111477 runs   2.00 s

enum Impl {
  index2pubkey,
  validatorsArr,
  persistent,
}

describe("api / impl / validator", () => {
  let state: ReturnType<typeof generatePerfTestCachedStatePhase0>;

  before(function () {
    this.timeout(60 * 1000);
    state = generatePerfTestCachedStatePhase0();
  });

  setBenchOpts({
    maxMs: 10 * 1000,
    minMs: 2 * 1000,
    runs: 1024,
  });

  // Only run for 1000 in CI to ensure performance does not degrade
  const reqCounts = process.env.CI ? [1000] : [1, 100, 1000];
  const impls = process.env.CI ? [Impl.persistent] : [Impl.index2pubkey, Impl.validatorsArr, Impl.persistent];

  if (impls.includes(Impl.index2pubkey)) {
    for (const reqCount of reqCounts) {
      itBench(`getPubkeys - index2pubkey - req ${reqCount} vs - ${numValidators} vc`, () => {
        for (let i = 0; i < reqCount; i++) {
          const pubkey = state.index2pubkey[i];
          pubkey.toBytes(PointFormat.compressed);
        }
      });
    }
  }

  if (impls.includes(Impl.validatorsArr)) {
    for (const reqCount of reqCounts) {
      itBench(`getPubkeys - validatorsArr - req ${reqCount} vs - ${numValidators} vc`, () => {
        for (let i = 0; i < reqCount; i++) {
          const validator = state.validators[i];
          validator.pubkey;
        }
      });
    }
  }

  if (impls.includes(Impl.persistent)) {
    for (const reqCount of reqCounts) {
      itBench(`getPubkeys - persistent - req ${reqCount} vs - ${numValidators} vc`, () => {
        const validators = state.validators.persistent;
        for (let i = 0; i < reqCount; i++) {
          const validator = validators.get(i);
          if (!validator) throw Error(`Index ${i} not found`);
          validator.pubkey;
        }
      });
    }
  }
});
