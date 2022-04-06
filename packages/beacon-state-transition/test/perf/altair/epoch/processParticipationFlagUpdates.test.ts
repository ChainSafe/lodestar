import {itBench} from "@dapplion/benchmark";
import {altair} from "../../../../src/index.js";
import {StateAltair} from "../../types.js";
import {generatePerfTestCachedStateAltair, numValidators} from "../../util";

// PERF: Cost = 'proportional' to $VALIDATOR_COUNT. Just copies a tree and recreates another

describe("altair processParticipationFlagUpdates", () => {
  const vc = numValidators;

  itBench<StateAltair, StateAltair>({
    id: `altair processParticipationFlagUpdates - ${vc} anycase`,
    yieldEventLoopAfterEach: true, // So SubTree(s)'s WeakRef can be garbage collected https://github.com/nodejs/node/issues/39902
    before: () => generatePerfTestCachedStateAltair({goBackOneSlot: true}),
    beforeEach: (state) => state.clone(),
    fn: (state) => altair.processParticipationFlagUpdates(state),
  });
});
