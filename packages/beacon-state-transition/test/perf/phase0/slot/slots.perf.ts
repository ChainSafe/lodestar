import {phase0} from "@chainsafe/lodestar-types";
import {generatePerfTestCachedBeaconState, initBLS} from "../../util";
import {BenchmarkRunner} from "@chainsafe/lodestar-utils";
import {allForks} from "../../../../src";

const testCases = [
  {numSlot: 32, name: "process 1 empty epoch"},
  {numSlot: 64, name: "process double empty epochs"},
  {numSlot: 128, name: "process 4 empty epochs"},
];
let originalState: allForks.CachedBeaconState<phase0.BeaconState>;
let state: allForks.CachedBeaconState<phase0.BeaconState>;

// As of Jun 01 2021
// Epoch transitions
// ================================================================
// process 1 empty epoch                                                0.6716265 ops/s   1.488923e+9 ns/op     10 runs
// process double empty epochs                                          0.3565964 ops/s   2.804291e+9 ns/op     10 runs
// process 4 empty epochs                                               0.2250960 ops/s   4.442549e+9 ns/op     10 runs

export const runEpochTransitionTests = async (): Promise<void> => {
  const runner = new BenchmarkRunner("Epoch transitions", {
    maxMs: 5 * 60 * 1000,
    runs: 5,
  });
  for (const {name, numSlot} of testCases) {
    await runner.run({
      id: name,
      before: async () => {
        await initBLS();
        originalState = generatePerfTestCachedBeaconState({goBackOneSlot: true});
      },
      beforeEach: () => {
        state = originalState.clone();
      },
      run: () => {
        allForks.processSlots(state as allForks.CachedBeaconState<allForks.BeaconState>, state.slot + numSlot);
      },
    });
  }
  runner.done();
};
