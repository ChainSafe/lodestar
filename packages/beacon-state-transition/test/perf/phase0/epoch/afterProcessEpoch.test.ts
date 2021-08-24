import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {allForks} from "../../../../src";
import {StateEpoch} from "../../types";
import {generatePerfTestCachedStatePhase0, perfStateId} from "../../util";

// PERF: Cost = compute attester and proposer shufflings ~ 'proportional' to $VALIDATOR_COUNT, but independent of
// network conditions. See also individual benchmarks for shuffling computations.

describe("phase0 afterProcessEpoch", () => {
  setBenchOpts({maxMs: 60 * 1000});

  itBench<StateEpoch, StateEpoch>({
    id: `phase0 afterProcessEpoch - ${perfStateId}`,
    before: () => {
      const state = generatePerfTestCachedStatePhase0({goBackOneSlot: true});
      const epochProcess = allForks.beforeProcessEpoch(state);
      return {state: state as allForks.CachedBeaconState<allForks.BeaconState>, epochProcess};
    },
    beforeEach: ({state, epochProcess}) => ({state: state.clone(), epochProcess}),
    fn: ({state, epochProcess}) => {
      allForks.afterProcessEpoch(state, epochProcess);
    },
  });
});
