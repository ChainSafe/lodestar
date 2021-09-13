import {itBench} from "@dapplion/benchmark";
import {allForks} from "../../../../src";
import {State} from "../../types";
import {generatePerfTestCachedStatePhase0, perfStateId} from "../../util";

// PERF: Two major steps:
// 1. Iterate over state.validators. Cost = 'proportional' to $VALIDATOR_COUNT not network conditions
// 2. Iterate over past attestations (phase0) Cost = 'proportional' to past attestations and bit count
// 3. Iterate over status to compute total balances. Cost = 'proportional' to $VALIDATOR_COUNT not network conditions

describe("phase0 beforeProcessEpoch", () => {
  itBench<State, State>({
    id: `phase0 beforeProcessEpoch - ${perfStateId}`,
    yieldEventLoopAfterEach: true, // So SubTree(s)'s WeakRef can be garbage collected https://github.com/nodejs/node/issues/39902
    before: () =>
      generatePerfTestCachedStatePhase0({goBackOneSlot: true}) as allForks.CachedBeaconState<allForks.BeaconState>,
    beforeEach: (state) => state.clone(),
    fn: (state) => {
      allForks.beforeProcessEpoch(state);
    },
  });
});
