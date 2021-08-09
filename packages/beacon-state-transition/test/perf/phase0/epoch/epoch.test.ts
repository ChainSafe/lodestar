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
  const epochProcess = allForks.beforeProcessEpoch(originalState);

  const idPrefix = `epoch phase0 - ${perfStateId}`;

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
    id: `${idPrefix} - beforeProcessEpoch`,
    fn: () => {
      allForks.beforeProcessEpoch(originalState);
    },
  });

  // Very cheap 187.21 us/op and unstable, skip in CI
  if (!process.env.CI)
    itBench({
      id: `${idPrefix} - processJustificationAndFinalization`,
      beforeEach: () => originalState.clone() as allForks.CachedBeaconState<allForks.BeaconState>,
      fn: (state) => allForks.processJustificationAndFinalization(state, epochProcess),
    });

  // Very expensive 976.40 ms/op good target to optimize
  itBench({
    id: `${idPrefix} - processRewardsAndPenalties`,
    beforeEach: () => originalState.clone(),
    fn: (state) => phase0.processRewardsAndPenalties(state, epochProcess),
  });

  // TODO: Needs a better state to test with, current does not include enough actions: 17.715 us/op
  if (!process.env.CI)
    itBench({
      id: `${idPrefix} - processRegistryUpdates`,
      beforeEach: () => originalState.clone() as allForks.CachedBeaconState<allForks.BeaconState>,
      fn: (state) => allForks.processRegistryUpdates(state, epochProcess),
    });

  // TODO: Needs a better state to test with, current does not include enough actions: 39.985 us/op
  if (!process.env.CI)
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
});
