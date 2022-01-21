import {EPOCHS_PER_SYNC_COMMITTEE_PERIOD} from "@chainsafe/lodestar-params";
import {itBench} from "@dapplion/benchmark";
import {processSyncCommitteeUpdates} from "../../../../src/altair";
import {StateAltair} from "../../types";
import {generatePerfTestCachedStateAltair, numValidators} from "../../util";

// PERF: Cost = once per epoch compute committee, proportional to $VALIDATOR_COUNT

describe("altair processSyncCommitteeUpdates", () => {
  const vc = numValidators;

  itBench<StateAltair, StateAltair>({
    id: `altair processSyncCommitteeUpdates - ${vc}`,
    yieldEventLoopAfterEach: true, // So SubTree(s)'s WeakRef can be garbage collected https://github.com/nodejs/node/issues/39902
    before: () => generatePerfTestCachedStateAltair({goBackOneSlot: true}),
    beforeEach: (state) => {
      if (state.epochCtx.epoch + (1 % EPOCHS_PER_SYNC_COMMITTEE_PERIOD) === 0) {
        // OK will run
      } else {
        throw Error("processSyncCommitteeUpdates will not rotate syncCommittees");
      }

      return state.clone();
    },
    fn: (state) => {
      processSyncCommitteeUpdates(state);
    },
  });
});
