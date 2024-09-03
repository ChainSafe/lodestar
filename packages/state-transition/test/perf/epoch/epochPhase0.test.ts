import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {ForkSeq} from "@lodestar/params";
import {
  computeStartSlotAtEpoch,
  CachedBeaconStateAllForks,
  CachedBeaconStatePhase0,
  beforeProcessEpoch,
} from "../../../src/index.js";
import {beforeValue, LazyValue} from "../../utils/beforeValueMocha.js";
import {getNetworkCachedState} from "../../utils/testFileCache.js";
import {StateEpoch} from "../types.js";
import {phase0State} from "../params.js";
import {processEpoch} from "../../../src/epoch/index.js";
import {processParticipationRecordUpdates} from "../../../src/epoch/processParticipationRecordUpdates.js";
import {processJustificationAndFinalization} from "../../../src/epoch/processJustificationAndFinalization.js";
import {processRewardsAndPenalties} from "../../../src/epoch/processRewardsAndPenalties.js";
import {processRegistryUpdates} from "../../../src/epoch/processRegistryUpdates.js";
import {processSlashings} from "../../../src/epoch/processSlashings.js";
import {processEth1DataReset} from "../../../src/epoch/processEth1DataReset.js";
import {processEffectiveBalanceUpdates} from "../../../src/epoch/processEffectiveBalanceUpdates.js";
import {processSlashingsReset} from "../../../src/epoch/processSlashingsReset.js";
import {processRandaoMixesReset} from "../../../src/epoch/processRandaoMixesReset.js";
import {processHistoricalRootsUpdate} from "../../../src/epoch/processHistoricalRootsUpdate.js";

const slot = computeStartSlotAtEpoch(phase0State.epoch) - 1;
const stateId = `${phase0State.network}_e${phase0State.epoch}`;
const fork = ForkSeq.phase0;

describe(`phase0 processEpoch - ${stateId}`, () => {
  setBenchOpts({
    yieldEventLoopAfterEach: true, // So SubTree(s)'s WeakRef can be garbage collected https://github.com/nodejs/node/issues/39902
  });

  const stateOg = beforeValue(async () => {
    const state = await getNetworkCachedState(phase0State.network, slot, 300_000);
    state.hashTreeRoot();
    return state;
  }, 300_000);

  itBench({
    id: `phase0 processEpoch - ${stateId}`,
    beforeEach: () => stateOg.value.clone(),
    fn: (state) => {
      const cache = beforeProcessEpoch(state);
      processEpoch(fork, state as CachedBeaconStatePhase0, cache);
      state.slot++;
      state.epochCtx.afterProcessEpoch(state, cache);
      // Simulate root computation through the next block to account for changes
      state.hashTreeRoot();
    },
  });

  // Only in local environment compute a full breakdown of the cost of each step
  describe(`phase0 processEpoch steps - ${stateId}`, () => {
    setBenchOpts({noThreshold: true});

    benchmarkPhase0EpochSteps(stateOg, stateId);
  });
});

function benchmarkPhase0EpochSteps(stateOg: LazyValue<CachedBeaconStateAllForks>, stateId: string): void {
  const cache = beforeValue(() => beforeProcessEpoch(stateOg.value));

  // Functions in same order as processEpoch()
  // Rough summary as of Aug 5th 2021
  //
  // epoch process function              | ms / op     | % bar chart
  // ----------------------------------- | ----------- | --------------
  // beforeProcessEpoch                  | 700.0 ms/op | xxxxxxxxxxxxxx
  // processJustificationAndFinalization | 0.180 ms/op |
  // processRewardsAndPenalties          | 600.0 ms/op | xxxxxxxxxxxx
  // processRegistryUpdates              | 0.017 ms/op |
  // processSlashings                    | 0.042 ms/op |
  // processEth1DataReset                | 0.000 ms/op |
  // processEffectiveBalanceUpdates      | 57.20 ms/op | x
  // processSlashingsReset               | 0.000 ms/op |
  // processRandaoMixesReset             | 0.000 ms/op |
  // processHistoricalRootsUpdate        | 0.000 ms/op |
  // processParticipationRecordUpdates   | 0.000 ms/op |

  itBench({
    id: `${stateId} - phase0 beforeProcessEpoch`,
    fn: () => {
      beforeProcessEpoch(stateOg.value);
    },
  });

  // Very cheap 187.21 us/op and unstable, skip in CI
  itBench({
    id: `${stateId} - phase0 processJustificationAndFinalization`,
    beforeEach: () => stateOg.value.clone(),
    fn: (state) => processJustificationAndFinalization(state, cache.value),
  });

  // Very expensive 976.40 ms/op good target to optimize
  itBench({
    id: `${stateId} - phase0 processRewardsAndPenalties`,
    beforeEach: () => stateOg.value.clone() as CachedBeaconStatePhase0,
    fn: (state) => processRewardsAndPenalties(state, cache.value),
  });

  // TODO: Needs a better state to test with, current does not include enough actions: 17.715 us/op
  itBench({
    id: `${stateId} - phase0 processRegistryUpdates`,
    beforeEach: () => stateOg.value.clone(),
    fn: (state) => processRegistryUpdates(ForkSeq.phase0, state, cache.value),
  });

  // TODO: Needs a better state to test with, current does not include enough actions: 39.985 us/op
  itBench({
    id: `${stateId} - phase0 processSlashings`,
    beforeEach: () => stateOg.value.clone() as CachedBeaconStatePhase0,
    fn: (state) => {
      processSlashings(state, cache.value, false);
    },
  });

  itBench({
    id: `${stateId} - phase0 processEth1DataReset`,
    beforeEach: () => stateOg.value.clone(),
    fn: (state) => processEth1DataReset(state, cache.value),
  });

  itBench({
    id: `${stateId} - phase0 processEffectiveBalanceUpdates`,
    beforeEach: () => stateOg.value.clone(),
    fn: (state) => {
      processEffectiveBalanceUpdates(ForkSeq.phase0, state, cache.value);
    },
  });

  itBench({
    id: `${stateId} - phase0 processSlashingsReset`,
    beforeEach: () => stateOg.value.clone(),
    fn: (state) => processSlashingsReset(state, cache.value),
  });

  itBench({
    id: `${stateId} - phase0 processRandaoMixesReset`,
    beforeEach: () => stateOg.value.clone(),
    fn: (state) => processRandaoMixesReset(state, cache.value),
  });

  itBench({
    id: `${stateId} - phase0 processHistoricalRootsUpdate`,
    beforeEach: () => stateOg.value.clone(),
    fn: (state) => processHistoricalRootsUpdate(state, cache.value),
  });

  itBench({
    id: `${stateId} - phase0 processParticipationRecordUpdates`,
    beforeEach: () => stateOg.value.clone() as CachedBeaconStatePhase0,
    fn: (state) => processParticipationRecordUpdates(state),
  });

  itBench<StateEpoch, StateEpoch>({
    id: `${stateId} - phase0 afterProcessEpoch`,
    // Compute a state and cache after running processEpoch() since those values are mutated
    before: () => {
      const state = stateOg.value.clone();
      const cacheAfter = beforeProcessEpoch(state);
      processEpoch(fork, state as CachedBeaconStatePhase0, cacheAfter);
      return {state, cache: cacheAfter};
    },
    beforeEach: ({state, cache}) => ({state: state.clone(), cache}),
    fn: ({state, cache}) => {
      state.slot++;
      state.epochCtx.afterProcessEpoch(state, cache);
    },
  });
}
