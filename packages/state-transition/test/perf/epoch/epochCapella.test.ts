import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {ForkSeq} from "@lodestar/params";
import {
  computeStartSlotAtEpoch,
  CachedBeaconStateAllForks,
  CachedBeaconStateCapella,
  CachedBeaconStateAltair,
  beforeProcessEpoch,
} from "../../../src/index.js";
import {beforeValue, LazyValue} from "../../utils/beforeValueMocha.js";
import {getNetworkCachedState} from "../../utils/testFileCache.js";
import {StateEpoch} from "../types.js";
import {capellaState} from "../params.js";
import {processJustificationAndFinalization} from "../../../src/epoch/processJustificationAndFinalization.js";
import {processInactivityUpdates} from "../../../src/epoch/processInactivityUpdates.js";
import {processRewardsAndPenalties} from "../../../src/epoch/processRewardsAndPenalties.js";
import {processRegistryUpdates} from "../../../src/epoch/processRegistryUpdates.js";
import {processSlashings} from "../../../src/epoch/processSlashings.js";
import {processEth1DataReset} from "../../../src/epoch/processEth1DataReset.js";
import {processEffectiveBalanceUpdates} from "../../../src/epoch/processEffectiveBalanceUpdates.js";
import {processSlashingsReset} from "../../../src/epoch/processSlashingsReset.js";
import {processRandaoMixesReset} from "../../../src/epoch/processRandaoMixesReset.js";
import {processHistoricalRootsUpdate} from "../../../src/epoch/processHistoricalRootsUpdate.js";
import {processParticipationFlagUpdates} from "../../../src/epoch/processParticipationFlagUpdates.js";
import {processEpoch} from "../../../src/epoch/index.js";

const slot = computeStartSlotAtEpoch(capellaState.epoch) - 1;
const stateId = `${capellaState.network}_e${capellaState.epoch}`;
const fork = ForkSeq.altair;

describe(`capella processEpoch - ${stateId}`, () => {
  setBenchOpts({
    yieldEventLoopAfterEach: true, // So SubTree(s)'s WeakRef can be garbage collected https://github.com/nodejs/node/issues/39902
  });

  const stateOg = beforeValue(async () => {
    const state = await getNetworkCachedState(capellaState.network, slot, 300_000);
    state.hashTreeRoot();
    return state;
  }, 300_000);

  itBench({
    id: `capella processEpoch - ${stateId}`,
    yieldEventLoopAfterEach: true, // So SubTree(s)'s WeakRef can be garbage collected https://github.com/nodejs/node/issues/39902
    beforeEach: () => stateOg.value.clone(),
    fn: (state) => {
      const cache = beforeProcessEpoch(state);
      processEpoch(fork, state as CachedBeaconStateCapella, cache);
      state.slot++;
      state.epochCtx.afterProcessEpoch(state, cache);
      // Simulate root computation through the next block to account for changes
      // 74184 hash64 ops - 92.730 ms
      state.hashTreeRoot();
    },
  });

  // Only in local environment compute a full breakdown of the cost of each step
  describe(`capella processEpoch steps - ${stateId}`, () => {
    setBenchOpts({noThreshold: true});

    benchmarkAltairEpochSteps(stateOg, stateId);
  });
});

function benchmarkAltairEpochSteps(stateOg: LazyValue<CachedBeaconStateAllForks>, stateId: string): void {
  const cache = beforeValue(() => beforeProcessEpoch(stateOg.value));

  // const getPerfState = (): CachedBeaconStateCapella => {
  //   const state = originalState.clone();
  //   state.setStateCachesAsTransient();
  //   return state;
  // };

  itBench({
    id: `${stateId} - capella beforeProcessEpoch`,
    fn: () => {
      beforeProcessEpoch(stateOg.value);
    },
  });

  itBench({
    id: `${stateId} - capella processJustificationAndFinalization`,
    beforeEach: () => stateOg.value.clone(),
    fn: (state) => processJustificationAndFinalization(state, cache.value),
  });

  itBench({
    id: `${stateId} - capella processInactivityUpdates`,
    beforeEach: () => stateOg.value.clone() as CachedBeaconStateAltair,
    fn: (state) => processInactivityUpdates(state, cache.value),
  });

  itBench({
    id: `${stateId} - capella processRewardsAndPenalties`,
    beforeEach: () => stateOg.value.clone() as CachedBeaconStateCapella,
    fn: (state) => processRewardsAndPenalties(state, cache.value),
  });

  // TODO: Needs a better state to test with, current does not include enough actions: 17.715 us/op
  itBench({
    id: `${stateId} - capella processRegistryUpdates`,
    beforeEach: () => stateOg.value.clone(),
    fn: (state) => processRegistryUpdates(ForkSeq.capella, state, cache.value),
  });

  // TODO: Needs a better state to test with, current does not include enough actions: 39.985 us/op
  itBench({
    id: `${stateId} - capella processSlashings`,
    beforeEach: () => stateOg.value.clone() as CachedBeaconStateCapella,
    fn: (state) => {
      processSlashings(state, cache.value, false);
    },
  });

  itBench({
    id: `${stateId} - capella processEth1DataReset`,
    beforeEach: () => stateOg.value.clone(),
    fn: (state) => processEth1DataReset(state, cache.value),
  });

  itBench({
    id: `${stateId} - capella processEffectiveBalanceUpdates`,
    beforeEach: () => stateOg.value.clone(),
    fn: (state) => {
      processEffectiveBalanceUpdates(ForkSeq.capella, state, cache.value);
    },
  });

  itBench({
    id: `${stateId} - capella processSlashingsReset`,
    beforeEach: () => stateOg.value.clone(),
    fn: (state) => processSlashingsReset(state, cache.value),
  });

  itBench({
    id: `${stateId} - capella processRandaoMixesReset`,
    beforeEach: () => stateOg.value.clone(),
    fn: (state) => processRandaoMixesReset(state, cache.value),
  });

  itBench({
    id: `${stateId} - capella processHistoricalRootsUpdate`,
    beforeEach: () => stateOg.value.clone(),
    fn: (state) => processHistoricalRootsUpdate(state, cache.value),
  });

  itBench({
    id: `${stateId} - capella processParticipationFlagUpdates`,
    beforeEach: () => stateOg.value.clone() as CachedBeaconStateAltair,
    fn: (state) => processParticipationFlagUpdates(state),
  });

  itBench<StateEpoch, StateEpoch>({
    id: `${stateId} - capella afterProcessEpoch`,
    // Compute a state and cache after running processEpoch() since those values are mutated
    before: () => {
      const state = stateOg.value.clone();
      const cacheAfter = beforeProcessEpoch(state);
      processEpoch(fork, state, cacheAfter);
      return {state, cache: cacheAfter};
    },
    beforeEach: ({state, cache}) => ({state: state.clone(), cache}),
    fn: ({state, cache}) => {
      state.slot++;
      state.epochCtx.afterProcessEpoch(state, cache);
    },
  });
}
