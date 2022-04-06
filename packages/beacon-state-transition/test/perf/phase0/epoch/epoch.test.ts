import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {
  allForks,
  computeStartSlotAtEpoch,
  phase0,
  CachedBeaconStateAllForks,
  CachedBeaconStatePhase0,
  beforeProcessEpoch,
} from "../../../../src/index.js";
import {beforeValue, getNetworkCachedState, LazyValue} from "../../util";
import {processParticipationRecordUpdates} from "../../../../src/phase0/epoch/processParticipationRecordUpdates.js";
import {StateEpoch} from "../../types.js";
import {phase0State} from "../../params.js";

const slot = computeStartSlotAtEpoch(phase0State.epoch) - 1;
const stateId = `${phase0State.network}_e${phase0State.epoch}`;

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
      const epochProcess = beforeProcessEpoch(state);
      phase0.processEpoch(state as CachedBeaconStatePhase0, epochProcess);
      state.epochCtx.afterProcessEpoch(state, epochProcess);
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
  const epochProcess = beforeValue(() => beforeProcessEpoch(stateOg.value));

  // Functions in same order as phase0.processEpoch()
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
    fn: (state) => allForks.processJustificationAndFinalization(state, epochProcess.value),
  });

  // Very expensive 976.40 ms/op good target to optimize
  itBench({
    id: `${stateId} - phase0 processRewardsAndPenalties`,
    beforeEach: () => stateOg.value.clone() as CachedBeaconStatePhase0,
    fn: (state) => phase0.processRewardsAndPenalties(state, epochProcess.value),
  });

  // TODO: Needs a better state to test with, current does not include enough actions: 17.715 us/op
  itBench({
    id: `${stateId} - phase0 processRegistryUpdates`,
    beforeEach: () => stateOg.value.clone(),
    fn: (state) => allForks.processRegistryUpdates(state, epochProcess.value),
  });

  // TODO: Needs a better state to test with, current does not include enough actions: 39.985 us/op
  itBench({
    id: `${stateId} - phase0 processSlashings`,
    beforeEach: () => stateOg.value.clone() as CachedBeaconStatePhase0,
    fn: (state) => phase0.processSlashings(state, epochProcess.value),
  });

  itBench({
    id: `${stateId} - phase0 processEth1DataReset`,
    beforeEach: () => stateOg.value.clone(),
    fn: (state) => allForks.processEth1DataReset(state, epochProcess.value),
  });

  itBench({
    id: `${stateId} - phase0 processEffectiveBalanceUpdates`,
    beforeEach: () => stateOg.value.clone(),
    fn: (state) => allForks.processEffectiveBalanceUpdates(state, epochProcess.value),
  });

  itBench({
    id: `${stateId} - phase0 processSlashingsReset`,
    beforeEach: () => stateOg.value.clone(),
    fn: (state) => allForks.processSlashingsReset(state, epochProcess.value),
  });

  itBench({
    id: `${stateId} - phase0 processRandaoMixesReset`,
    beforeEach: () => stateOg.value.clone(),
    fn: (state) => allForks.processRandaoMixesReset(state, epochProcess.value),
  });

  itBench({
    id: `${stateId} - phase0 processHistoricalRootsUpdate`,
    beforeEach: () => stateOg.value.clone(),
    fn: (state) => allForks.processHistoricalRootsUpdate(state, epochProcess.value),
  });

  itBench({
    id: `${stateId} - phase0 processParticipationRecordUpdates`,
    beforeEach: () => stateOg.value.clone() as CachedBeaconStatePhase0,
    fn: (state) => processParticipationRecordUpdates(state),
  });

  itBench<StateEpoch, StateEpoch>({
    id: `${stateId} - phase0 afterProcessEpoch`,
    // Compute a state and epochProcess after running processEpoch() since those values are mutated
    before: () => {
      const state = stateOg.value.clone();
      const epochProcessAfter = beforeProcessEpoch(state);
      phase0.processEpoch(state as CachedBeaconStatePhase0, epochProcessAfter);
      return {state, epochProcess: epochProcessAfter};
    },
    beforeEach: ({state, epochProcess}) => ({state: state.clone(), epochProcess}),
    fn: ({state, epochProcess}) => state.epochCtx.afterProcessEpoch(state, epochProcess),
  });
}
