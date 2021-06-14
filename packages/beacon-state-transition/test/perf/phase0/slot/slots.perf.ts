import {init} from "@chainsafe/bls";
import {generatePerfTestCachedBeaconState} from "../../util";
import {BenchmarkRunner} from "@chainsafe/lodestar-utils/test_utils/benchmark";
import {allForks} from "../../../../src";

// Testing going through 1,2,4 epoch transitions has the same proportional result
const testCases = [{numSlot: 32, name: "process 1 empty epoch"}];

// As of Jun 01 2021
// Epoch transitions
// ================================================================
// process 1 empty epoch                                                0.6716265 ops/s   1.488923e+9 ns/op     10 runs
// process double empty epochs                                          0.3565964 ops/s   2.804291e+9 ns/op     10 runs
// process 4 empty epochs                                               0.2250960 ops/s   4.442549e+9 ns/op     10 runs

export async function runEpochTransitionTests(): Promise<void> {
  const runner = new BenchmarkRunner("Epoch transitions", {
    maxMs: 60 * 1000,
    minMs: 15 * 1000,
    runs: 64,
  });

  await init("blst-native");

  const originalState = generatePerfTestCachedBeaconState({goBackOneSlot: true});

  for (const {name, numSlot} of testCases) {
    await runner.run({
      id: name,
      beforeEach: () => originalState.clone(),
      run: (state) => {
        allForks.processSlots(state as allForks.CachedBeaconState<allForks.BeaconState>, state.slot + numSlot);
      },
    });
  }

  runner.done();
}
