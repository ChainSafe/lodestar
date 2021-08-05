import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {allForks, phase0} from "../../../../src";
import {generatePerfTestCachedStatePhase0, perfStateId} from "../../util";

describe("Phase 0 epoch transition steps", () => {
  setBenchOpts({
    maxMs: 60 * 1000,
    minMs: 15 * 1000,
    runs: 64,
  });

  const originalState = generatePerfTestCachedStatePhase0({goBackOneSlot: true});
  const epochProcess = allForks.prepareEpochProcessState(originalState);

  const idPrefix = `epoch phase0 - ${perfStateId}`;

  itBench({
    id: `${idPrefix} - processJustificationAndFinalization`,
    beforeEach: () => originalState.clone() as allForks.CachedBeaconState<allForks.BeaconState>,
    fn: (state) => phase0.processJustificationAndFinalization(state, epochProcess),
  });

  itBench({
    id: `${idPrefix} - processRewardsAndPenalties`,
    beforeEach: () => originalState.clone(),
    fn: (state) => phase0.processRewardsAndPenalties(state, epochProcess),
  });

  itBench({
    id: `${idPrefix} - processRegistryUpdates`,
    beforeEach: () => originalState.clone() as allForks.CachedBeaconState<allForks.BeaconState>,
    fn: (state) => phase0.processRegistryUpdates(state, epochProcess),
  });

  itBench({
    id: `${idPrefix} - processSlashings`,
    beforeEach: () => originalState.clone(),
    fn: (state) => phase0.processSlashings(state, epochProcess),
  });

  itBench({
    id: `${idPrefix} - processFinalUpdates`,
    beforeEach: () => originalState.clone(),
    fn: (state) => phase0.processFinalUpdates(state, epochProcess),
  });

  // Non-action perf

  itBench({
    id: `${idPrefix} - prepareEpochProcessState`,
    fn: () => {
      allForks.prepareEpochProcessState(originalState);
    },
  });
});
