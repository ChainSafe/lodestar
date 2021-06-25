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

  const valCount = originalState.validators.length;
  const idPrefix = `epoch - ${valCount} vs - `;

  itBench({
    id: `${idPrefix} processJustificationAndFinalization`,
    beforeEach: () => originalState.clone() as allForks.CachedBeaconState<allForks.BeaconState>,
    fn: (state) => phase0.processJustificationAndFinalization(state, process),
  });

  itBench({
    id: `${idPrefix} processRewardsAndPenalties`,
    beforeEach: () => originalState.clone(),
    fn: (state) => phase0.processRewardsAndPenalties(state, process),
  });

  itBench({
    id: `${idPrefix} processRegistryUpdates`,
    beforeEach: () => originalState.clone() as allForks.CachedBeaconState<allForks.BeaconState>,
    fn: (state) => phase0.processRegistryUpdates(state, process),
  });

  itBench({
    id: `${idPrefix} processSlashings`,
    beforeEach: () => originalState.clone(),
    fn: (state) => phase0.processSlashings(state, process),
  });

  itBench({
    id: `${idPrefix} processFinalUpdates`,
    beforeEach: () => originalState.clone(),
    fn: (state) => phase0.processFinalUpdates(state, process),
  });

  // Non-action perf

  itBench({
    id: `${idPrefix} prepareEpochProcessState`,
    fn: () => {
      allForks.prepareEpochProcessState(originalState);
    },
  });
});
