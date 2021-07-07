import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {allForks, altair} from "../../../../src";
import {generatePerfTestCachedStateAltair, perfStateId} from "../../util";

describe("Altair epoch transition steps", () => {
  setBenchOpts({
    maxMs: 60 * 1000,
    minMs: 15 * 1000,
    runs: 64,
  });

  const originalState = generatePerfTestCachedStateAltair({goBackOneSlot: true});
  const process = allForks.prepareEpochProcessState(originalState);

  const idPrefix = `epoch altair - ${perfStateId}`;

  itBench({
    id: `${idPrefix} - processJustificationAndFinalization`,
    beforeEach: () => originalState.clone() as allForks.CachedBeaconState<allForks.BeaconState>,
    fn: (state) => altair.processJustificationAndFinalization(state, process),
  });

  const mutatedState = originalState.clone();
  altair.processJustificationAndFinalization(mutatedState as allForks.CachedBeaconState<allForks.BeaconState>, process);

  // As of Jun 18
  // Altair epoch transition steps
  // ================================================================
  // processInactivityUpdates                                              0.6118570 ops/s      1.634369  s/op     36 runs    60.48 s
  itBench({
    id: `${idPrefix} - processInactivityUpdates`,
    beforeEach: () => mutatedState.clone(),
    fn: (state) => altair.processInactivityUpdates(state, process),
  });

  altair.processInactivityUpdates(mutatedState, process);

  itBench({
    id: `${idPrefix} - processRewardsAndPenalties`,
    beforeEach: () => mutatedState.clone(),
    fn: (state) => altair.processRewardsAndPenalties(state, process),
  });

  altair.processRewardsAndPenalties(mutatedState, process);

  itBench({
    id: `${idPrefix} - processRegistryUpdates`,
    beforeEach: () => mutatedState.clone() as allForks.CachedBeaconState<allForks.BeaconState>,
    fn: (state) => altair.processRegistryUpdates(state, process),
  });

  altair.processRegistryUpdates(mutatedState as allForks.CachedBeaconState<allForks.BeaconState>, process);

  itBench({
    id: `${idPrefix} - processSlashings`,
    beforeEach: () => mutatedState.clone(),
    fn: (state) => altair.processSlashings(state, process),
  });

  altair.processSlashings(mutatedState, process);

  itBench({
    id: `${idPrefix} - processEth1DataReset`,
    beforeEach: () => mutatedState.clone() as allForks.CachedBeaconState<allForks.BeaconState>,
    fn: (state) => allForks.processEth1DataReset(state, process),
  });

  allForks.processEth1DataReset(mutatedState as allForks.CachedBeaconState<allForks.BeaconState>, process);

  itBench({
    id: `${idPrefix} - processEffectiveBalanceUpdates`,
    beforeEach: () => mutatedState.clone() as allForks.CachedBeaconState<allForks.BeaconState>,
    fn: (state) => allForks.processEffectiveBalanceUpdates(state, process),
  });

  allForks.processEffectiveBalanceUpdates(mutatedState as allForks.CachedBeaconState<allForks.BeaconState>, process);

  itBench({
    id: `${idPrefix} - processSlashingsReset`,
    beforeEach: () => mutatedState.clone() as allForks.CachedBeaconState<allForks.BeaconState>,
    fn: (state) => allForks.processSlashingsReset(state, process),
  });

  allForks.processSlashingsReset(mutatedState as allForks.CachedBeaconState<allForks.BeaconState>, process);

  itBench({
    id: `${idPrefix} - processRandaoMixesReset`,
    beforeEach: () => mutatedState.clone() as allForks.CachedBeaconState<allForks.BeaconState>,
    fn: (state) => allForks.processRandaoMixesReset(state, process),
  });

  allForks.processRandaoMixesReset(mutatedState as allForks.CachedBeaconState<allForks.BeaconState>, process);

  itBench({
    id: `${idPrefix} - processHistoricalRootsUpdate`,
    beforeEach: () => mutatedState.clone() as allForks.CachedBeaconState<allForks.BeaconState>,
    fn: (state) => allForks.processHistoricalRootsUpdate(state, process),
  });

  allForks.processHistoricalRootsUpdate(mutatedState as allForks.CachedBeaconState<allForks.BeaconState>, process);

  itBench({
    id: `${idPrefix} - processParticipationFlagUpdates`,
    beforeEach: () => mutatedState.clone(),
    fn: (state) => altair.processParticipationFlagUpdates(state),
  });

  altair.processParticipationFlagUpdates(mutatedState);

  itBench({
    id: `${idPrefix} - processSyncCommitteeUpdates`,
    beforeEach: () => mutatedState.clone(),
    fn: (state) => altair.processSyncCommitteeUpdates(state, process),
  });

  // do prepareEpochProcessState last
  itBench({
    id: `${idPrefix} - prepareEpochProcessState`,
    beforeEach: () => originalState.clone() as allForks.CachedBeaconState<allForks.BeaconState>,
    fn: (state) => void allForks.prepareEpochProcessState(state),
  });
});
