import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {
  allForks,
  altair,
  computeStartSlotAtEpoch,
  CachedBeaconStateAllForks,
  CachedBeaconStateAltair,
  beforeProcessEpoch,
} from "../../../../src/index.js";
import {beforeValue, getNetworkCachedState, LazyValue} from "../../util";
import {StateEpoch} from "../../types.js";
import {altairState} from "../../params.js";

const slot = computeStartSlotAtEpoch(altairState.epoch) - 1;
const stateId = `${altairState.network}_e${altairState.epoch}`;

describe(`altair processEpoch - ${stateId}`, () => {
  setBenchOpts({
    yieldEventLoopAfterEach: true, // So SubTree(s)'s WeakRef can be garbage collected https://github.com/nodejs/node/issues/39902
  });

  const stateOg = beforeValue(async () => {
    const state = await getNetworkCachedState(altairState.network, slot, 300_000);
    state.hashTreeRoot();
    return state;
  }, 300_000);

  itBench({
    id: `altair processEpoch - ${stateId}`,
    yieldEventLoopAfterEach: true, // So SubTree(s)'s WeakRef can be garbage collected https://github.com/nodejs/node/issues/39902
    beforeEach: () => stateOg.value.clone(),
    fn: (state) => {
      const epochProcess = beforeProcessEpoch(state);
      altair.processEpoch(state as CachedBeaconStateAltair, epochProcess);
      state.epochCtx.afterProcessEpoch(state, epochProcess);
      // Simulate root computation through the next block to account for changes
      // 74184 hash64 ops - 92.730 ms
      state.hashTreeRoot();
    },
  });

  // Only in local environment compute a full breakdown of the cost of each step
  describe(`altair processEpoch steps - ${stateId}`, () => {
    setBenchOpts({noThreshold: true});

    benchmarkAltairEpochSteps(stateOg, stateId);
  });
});

function benchmarkAltairEpochSteps(stateOg: LazyValue<CachedBeaconStateAllForks>, stateId: string): void {
  const epochProcess = beforeValue(() => beforeProcessEpoch(stateOg.value));

  // const getPerfState = (): CachedBeaconStateAltair => {
  //   const state = originalState.clone();
  //   state.setStateCachesAsTransient();
  //   return state;
  // };

  // Note: tests altair only methods. All other are benchmarked in phase/epoch

  // Functions in same order as altair.processEpoch()
  // Rough summary as of Aug 5th 2021
  //
  // epoch process function              | ms / op     | % bar chart
  // ----------------------------------- | ----------- | --------------
  // beforeProcessEpoch                  | 700.0 ms/op | xxxxxxxxxxxxxx
  // processJustificationAndFinalization | 0.180 ms/op |
  // processInactivityUpdates            | 7500. ms/op | xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  // processRewardsAndPenalties          | 900.0 ms/op | xxxxxxxxxxxxxxxxxx
  // processRegistryUpdates              | 0.017 ms/op |
  // processSlashings                    | 0.042 ms/op |
  // processEth1DataReset                | 0.000 ms/op |
  // processEffectiveBalanceUpdates      | 57.20 ms/op | x
  // processSlashingsReset               | 0.000 ms/op |
  // processRandaoMixesReset             | 0.000 ms/op |
  // processHistoricalRootsUpdate        | 0.000 ms/op |
  // processParticipationFlagUpdates     | 300.0 ms/op | xxxxxx
  // processSyncCommitteeUpdates         | 0.000 ms/op |

  itBench({
    id: `${stateId} - altair beforeProcessEpoch`,
    fn: () => {
      beforeProcessEpoch(stateOg.value);
    },
  });

  itBench({
    id: `${stateId} - altair processJustificationAndFinalization`,
    beforeEach: () => stateOg.value.clone(),
    fn: (state) => allForks.processJustificationAndFinalization(state, epochProcess.value),
  });

  itBench({
    id: `${stateId} - altair processInactivityUpdates`,
    beforeEach: () => stateOg.value.clone() as CachedBeaconStateAltair,
    fn: (state) => altair.processInactivityUpdates(state, epochProcess.value),
  });

  itBench({
    id: `${stateId} - altair processRewardsAndPenalties`,
    beforeEach: () => stateOg.value.clone() as CachedBeaconStateAltair,
    fn: (state) => altair.processRewardsAndPenalties(state, epochProcess.value),
  });

  // TODO: Needs a better state to test with, current does not include enough actions: 17.715 us/op
  itBench({
    id: `${stateId} - altair processRegistryUpdates`,
    beforeEach: () => stateOg.value.clone(),
    fn: (state) => allForks.processRegistryUpdates(state, epochProcess.value),
  });

  // TODO: Needs a better state to test with, current does not include enough actions: 39.985 us/op
  itBench({
    id: `${stateId} - altair processSlashings`,
    beforeEach: () => stateOg.value.clone() as CachedBeaconStateAltair,
    fn: (state) => altair.processSlashings(state, epochProcess.value),
  });

  itBench({
    id: `${stateId} - altair processEth1DataReset`,
    beforeEach: () => stateOg.value.clone(),
    fn: (state) => allForks.processEth1DataReset(state, epochProcess.value),
  });

  itBench({
    id: `${stateId} - altair processEffectiveBalanceUpdates`,
    beforeEach: () => stateOg.value.clone(),
    fn: (state) => allForks.processEffectiveBalanceUpdates(state, epochProcess.value),
  });

  itBench({
    id: `${stateId} - altair processSlashingsReset`,
    beforeEach: () => stateOg.value.clone(),
    fn: (state) => allForks.processSlashingsReset(state, epochProcess.value),
  });

  itBench({
    id: `${stateId} - altair processRandaoMixesReset`,
    beforeEach: () => stateOg.value.clone(),
    fn: (state) => allForks.processRandaoMixesReset(state, epochProcess.value),
  });

  itBench({
    id: `${stateId} - altair processHistoricalRootsUpdate`,
    beforeEach: () => stateOg.value.clone(),
    fn: (state) => allForks.processHistoricalRootsUpdate(state, epochProcess.value),
  });

  itBench({
    id: `${stateId} - altair processParticipationFlagUpdates`,
    beforeEach: () => stateOg.value.clone() as CachedBeaconStateAltair,
    fn: (state) => altair.processParticipationFlagUpdates(state),
  });

  itBench({
    id: `${stateId} - altair processSyncCommitteeUpdates`,
    convergeFactor: 1 / 100, // Very unstable make it converge faster
    beforeEach: () => stateOg.value.clone() as CachedBeaconStateAltair,
    fn: (state) => altair.processSyncCommitteeUpdates(state),
  });

  itBench<StateEpoch, StateEpoch>({
    id: `${stateId} - altair afterProcessEpoch`,
    // Compute a state and epochProcess after running processEpoch() since those values are mutated
    before: () => {
      const state = stateOg.value.clone();
      const epochProcessAfter = beforeProcessEpoch(state);
      altair.processEpoch(state as CachedBeaconStateAltair, epochProcessAfter);
      return {state, epochProcess: epochProcessAfter};
    },
    beforeEach: ({state, epochProcess}) => ({state: state.clone(), epochProcess}),
    fn: ({state, epochProcess}) => state.epochCtx.afterProcessEpoch(state, epochProcess),
  });
}
