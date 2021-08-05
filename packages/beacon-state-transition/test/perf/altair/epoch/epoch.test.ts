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
  const epochProcess = allForks.prepareEpochProcessState(originalState);

  const idPrefix = `epoch altair - ${perfStateId}`;

  // Note: tests altair only methods. All other are benchmarked in phase/epoch

  itBench({
    id: `${idPrefix} - processInactivityUpdates`,
    beforeEach: () => originalState.clone(),
    fn: (state) => altair.processInactivityUpdates(state, epochProcess),
  });

  itBench({
    id: `${idPrefix} - processRewardsAndPenalties`,
    beforeEach: () => originalState.clone(),
    fn: (state) => altair.processRewardsAndPenalties(state, epochProcess),
  });

  itBench({
    id: `${idPrefix} - processSlashings`,
    beforeEach: () => originalState.clone(),
    fn: (state) => altair.processSlashings(state, epochProcess),
  });

  itBench({
    id: `${idPrefix} - processParticipationFlagUpdates`,
    beforeEach: () => originalState.clone(),
    fn: (state) => altair.processParticipationFlagUpdates(state),
  });

  // very simple and fast function, no need to benchmark
  if (!process.env.CI) {
    itBench({
      id: `${idPrefix} - processSyncCommitteeUpdates`,
      beforeEach: () => originalState.clone(),
      fn: (state) => altair.processSyncCommitteeUpdates(state, epochProcess),
    });
  }
});
