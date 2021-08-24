import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {altair} from "../../../../src";
import {StateAltair} from "../../types";
import {generatePerfTestCachedStateAltair, numValidators} from "../../util";

// PERF: Cost = 'proportional' to $VALIDATOR_COUNT. Just copies a tree and recreates another

describe("altair processParticipationFlagUpdates", () => {
  setBenchOpts({maxMs: 60 * 1000});

  const vc = numValidators;

  itBench<StateAltair, StateAltair>({
    id: `altair processParticipationFlagUpdates - ${vc} anycase`,
    before: () => generatePerfTestCachedStateAltair({goBackOneSlot: true}),
    beforeEach: (state) => state.clone(),
    fn: (state) => altair.processParticipationFlagUpdates(state),
  });
});
