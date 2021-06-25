import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {generatePerfTestCachedBeaconState} from "../../util";
import {allForks} from "../../../../src";

// As of Jun 01 2021
// Epoch transitions
// ================================================================
// process 1 empty epoch                                                0.6716265 ops/s   1.488923e+9 ns/op     10 runs
// process double empty epochs                                          0.3565964 ops/s   2.804291e+9 ns/op     10 runs
// process 4 empty epochs                                               0.2250960 ops/s   4.442549e+9 ns/op     10 runs

describe("Epoch transitions", () => {
  setBenchOpts({
    maxMs: 60 * 1000,
    minMs: 15 * 1000,
    runs: 64,
  });

  const originalState = generatePerfTestCachedBeaconState({goBackOneSlot: true});
  const valCount = originalState.validators.length;

  // Testing going through 1,2,4 epoch transitions has the same proportional result
  const testCases = [
    {
      numSlot: 32,
      id: `processSlots - ${valCount} vs - 32 empty slots`,
    },
  ];

  for (const {id, numSlot} of testCases) {
    itBench({id, beforeEach: () => originalState.clone()}, (state) => {
      allForks.processSlots(state as allForks.CachedBeaconState<allForks.BeaconState>, state.slot + numSlot);
    });
  }
});
