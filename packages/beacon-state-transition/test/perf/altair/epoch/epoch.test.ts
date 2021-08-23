import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {allForks, altair, CachedBeaconState} from "../../../../src";
import {generatePerfTestCachedStateAltair, perfStateId} from "../../util";

describe("Altair epoch transition steps", () => {
  setBenchOpts({maxMs: 60 * 1000});

  const originalState = generatePerfTestCachedStateAltair({goBackOneSlot: true});
  const epochProcess = allForks.beforeProcessEpoch(originalState);

  const getPerfState = (): CachedBeaconState<altair.BeaconState> => {
    const state = originalState.clone();
    state.setStateCachesAsTransient();
    return state;
  };

  const idPrefix = `epoch altair - ${perfStateId}`;

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

  // beforeProcessEpoch - in phase0
  // processJustificationAndFinalization - in phase0

  itBench({
    id: `${idPrefix} - processInactivityUpdates`,
    beforeEach: () => getPerfState(),
    fn: (state) => altair.processInactivityUpdates(state, epochProcess),
  });

  itBench({
    id: `${idPrefix} - processRewardsAndPenalties`,
    beforeEach: () => getPerfState(),
    fn: (state) => altair.processRewardsAndPenalties(state, epochProcess),
  });

  // processRegistryUpdates - in phase0

  // Very cheap 32.04 us/op and unstable, skip in CI
  if (!process.env.CI)
    itBench({
      id: `${idPrefix} - processSlashings`,
      beforeEach: () => getPerfState(),
      fn: (state) => altair.processSlashings(state, epochProcess),
    });

  // processEth1DataReset - in phase0
  // processEffectiveBalanceUpdates - in phase0
  // processSlashingsReset - in phase0
  // processRandaoMixesReset - in phase0
  // processHistoricalRootsUpdate - in phase0

  itBench({
    id: `${idPrefix} - processParticipationFlagUpdates`,
    beforeEach: () => getPerfState(),
    fn: (state) => altair.processParticipationFlagUpdates(state),
  });

  // Very cheap ??.?? us/op and unstable, skip in CI
  if (!process.env.CI)
    itBench({
      id: `${idPrefix} - processSyncCommitteeUpdates`,
      beforeEach: () => getPerfState(),
      fn: (state) => altair.processSyncCommitteeUpdates(state, epochProcess),
    });
});
