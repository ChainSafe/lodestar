import {EPOCHS_PER_SYNC_COMMITTEE_PERIOD} from "@chainsafe/lodestar-params";
import {itBench} from "@dapplion/benchmark";
import {processSyncCommitteeUpdates} from "../../../../src/altair/index.js";
import {StateAltair} from "../../types.js";
import {generatePerfTestCachedStateAltair, numValidators} from "../../util";

// PERF: Cost = once per epoch compute committee, proportional to $VALIDATOR_COUNT

describe("altair processSyncCommitteeUpdates", () => {
  const vc = numValidators;

  itBench<StateAltair, StateAltair>({
    id: `altair processSyncCommitteeUpdates - ${vc}`,
    yieldEventLoopAfterEach: true, // So SubTree(s)'s WeakRef can be garbage collected https://github.com/nodejs/node/issues/39902
    before: () => generatePerfTestCachedStateAltair({goBackOneSlot: true}),
    beforeEach: (state) => {
      const stateCloned = state.clone();
      // Force processSyncCommitteeUpdates to run
      stateCloned.epochCtx.epoch = EPOCHS_PER_SYNC_COMMITTEE_PERIOD - 1;
      return stateCloned;
    },
    fn: (state) => {
      const nextSyncCommitteeBefore = state.nextSyncCommittee;
      processSyncCommitteeUpdates(state);
      if (state.nextSyncCommittee === nextSyncCommitteeBefore) {
        throw Error("nextSyncCommittee instance has not changed");
      }
    },
  });
});
