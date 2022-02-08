import {EPOCHS_PER_SYNC_COMMITTEE_PERIOD} from "@chainsafe/lodestar-params";
import {itBench} from "@dapplion/benchmark";
import {altair} from "../../../../src";
import {StateAltair} from "../../types";
import {generatePerfTestCachedStateAltair, numValidators} from "../../util";

// PERF: Cost = once per epoch compute committee, proportional to $VALIDATOR_COUNT

describe("altair processSyncCommitteeUpdates", () => {
  const vc = numValidators;

  itBench<StateAltair, StateAltair>({
    id: `altair processSyncCommitteeUpdates - ${vc}`,
    yieldEventLoopAfterEach: true, // So SubTree(s)'s WeakRef can be garbage collected https://github.com/nodejs/node/issues/39902
    before: () => {
      const state = generatePerfTestCachedStateAltair({goBackOneSlot: true});
      state.epochCtx.epoch = EPOCHS_PER_SYNC_COMMITTEE_PERIOD - 1;
      return state;
    },
    beforeEach: (state) => state.clone(),
    fn: (state) => altair.processSyncCommitteeUpdates(state),
  });
});
