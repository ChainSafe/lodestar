import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {allForks, phase0} from "../../../../src";
import {generatePerfTestCachedBeaconState} from "../../util";

describe("Epoch transition steps", () => {
  setBenchOpts({
    maxMs: 60 * 1000,
    minMs: 15 * 1000,
    runs: 64,
  });

  const originalState = generatePerfTestCachedBeaconState({goBackOneSlot: true});
  const process = allForks.prepareEpochProcessState(originalState);

  itBench({
    id: "processJustificationAndFinalization",
    beforeEach: () => originalState.clone() as allForks.CachedBeaconState<allForks.BeaconState>,
    fn: (state) => phase0.processJustificationAndFinalization(state, process),
  });

  itBench({
    id: "processRewardsAndPenalties",
    beforeEach: () => originalState.clone(),
    fn: (state) => phase0.processRewardsAndPenalties(state, process),
  });

  itBench({
    id: "processRegistryUpdates",
    beforeEach: () => originalState.clone() as allForks.CachedBeaconState<allForks.BeaconState>,
    fn: (state) => phase0.processRegistryUpdates(state, process),
  });

  itBench({
    id: "processSlashings",
    beforeEach: () => originalState.clone(),
    fn: (state) => phase0.processSlashings(state, process),
  });

  itBench({
    id: "processFinalUpdates",
    beforeEach: () => originalState.clone(),
    fn: (state) => phase0.processFinalUpdates(state, process),
  });

  // Non-action perf

  itBench({
    id: "prepareEpochProcessState",
    fn: () => {
      allForks.prepareEpochProcessState(originalState);
    },
  });
});
