import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {StateAltair} from "../../types";
import {generatePerfTestCachedStateAltair, numValidators} from "../../util";

// PERF: Cost = once per epoch compute committee, proportional to $VALIDATOR_COUNT

describe("altair processSyncCommitteeUpdates", () => {
  setBenchOpts({maxMs: 60 * 1000, minRuns: 10});

  const vc = numValidators;

  itBench<StateAltair, StateAltair>({
    id: `altair processSyncCommitteeUpdates - ${vc}`,
    before: () => generatePerfTestCachedStateAltair({goBackOneSlot: true}),
    beforeEach: (state) => state.clone(),
    fn: (state) => state.rotateSyncCommittee(),
  });
});
