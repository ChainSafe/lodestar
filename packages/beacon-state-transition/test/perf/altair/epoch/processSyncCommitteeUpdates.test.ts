import {itBench} from "@dapplion/benchmark";
import {StateAltair} from "../../types";
import {generatePerfTestCachedStateAltair, numValidators} from "../../util";

// PERF: Cost = once per epoch compute committee, proportional to $VALIDATOR_COUNT

describe("altair processSyncCommitteeUpdates", () => {
  const vc = numValidators;

  itBench<StateAltair, StateAltair>({
    id: `altair processSyncCommitteeUpdates - ${vc}`,
    yieldEventLoopAfterEach: true, // So SubTree(s)'s WeakRef can be garbage collected https://github.com/nodejs/node/issues/39902
    before: () => generatePerfTestCachedStateAltair({goBackOneSlot: true}),
    beforeEach: (state) => state.clone(),
    fn: (state) => state.rotateSyncCommittee(),
  });
});
