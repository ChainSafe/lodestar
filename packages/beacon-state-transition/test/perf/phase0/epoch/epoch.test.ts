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
    fn: (state) => allForks.processJustificationAndFinalization(state, epochProcess),
  });

  itBench({
    id: `${idPrefix} - processRewardsAndPenalties`,
    beforeEach: () => originalState.clone(),
    fn: (state) => phase0.processRewardsAndPenalties(state, epochProcess),
  });

  itBench({
    id: `${idPrefix} - processRegistryUpdates`,
    beforeEach: () => originalState.clone() as allForks.CachedBeaconState<allForks.BeaconState>,
    fn: (state) => allForks.processRegistryUpdates(state, epochProcess),
  });

  itBench({
    id: `${idPrefix} - processSlashings`,
    beforeEach: () => originalState.clone(),
    fn: (state) => phase0.processSlashings(state, epochProcess),
  });

  itBench({
    id: `${idPrefix} - processEffectiveBalanceUpdates`,
    beforeEach: () => originalState.clone() as allForks.CachedBeaconState<allForks.BeaconState>,
    fn: (state) => allForks.processEffectiveBalanceUpdates(state, epochProcess),
  });

  // very simple and fast functions, no need to benchmark
  if (!process.env.CI) {
    itBench({
      id: `${idPrefix} - processEth1DataReset`,
      beforeEach: () => originalState.clone() as allForks.CachedBeaconState<allForks.BeaconState>,
      fn: (state) => allForks.processEth1DataReset(state, epochProcess),
    });

    itBench({
      id: `${idPrefix} - processSlashingsReset`,
      beforeEach: () => originalState.clone() as allForks.CachedBeaconState<allForks.BeaconState>,
      fn: (state) => allForks.processSlashingsReset(state, epochProcess),
    });

    itBench({
      id: `${idPrefix} - processRandaoMixesReset`,
      beforeEach: () => originalState.clone() as allForks.CachedBeaconState<allForks.BeaconState>,
      fn: (state) => allForks.processRandaoMixesReset(state, epochProcess),
    });

    itBench({
      id: `${idPrefix} - processHistoricalRootsUpdate`,
      beforeEach: () => originalState.clone() as allForks.CachedBeaconState<allForks.BeaconState>,
      fn: (state) => allForks.processHistoricalRootsUpdate(state, epochProcess),
    });

    // processParticipationRecordUpdates, no need to benchmark. Way too simple
  }

  // Other items in phase0 epoch processing are too small to care about performance

  // Non-action perf

  itBench({
    id: `${idPrefix} - prepareEpochProcessState`,
    fn: () => {
      allForks.prepareEpochProcessState(originalState);
    },
  });
});
