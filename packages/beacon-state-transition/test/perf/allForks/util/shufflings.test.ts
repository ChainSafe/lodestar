import {itBench} from "@dapplion/benchmark";
import {Epoch} from "@chainsafe/lodestar-types";
import {allForks, computeEpochAtSlot} from "../../../../src";
import {computeEpochShuffling, computeProposers} from "../../../../src/allForks";
import {generatePerfTestCachedStatePhase0, numValidators} from "../../util";
import {getNextSyncCommittee} from "../../../../src/altair/util/syncCommittee";

describe("epoch shufflings", () => {
  let state: allForks.CachedBeaconState<allForks.BeaconState>;
  let nextEpoch: Epoch;

  before(function () {
    this.timeout(60 * 1000);
    state = generatePerfTestCachedStatePhase0() as allForks.CachedBeaconState<allForks.BeaconState>;
    nextEpoch = computeEpochAtSlot(state.slot) + 1;

    // Sanity check to ensure numValidators doesn't go stale
    if (state.validators.length !== numValidators) throw Error("constant numValidators is wrong");
  });

  itBench({
    id: `computeProposers - vc ${numValidators}`,
    fn: () => {
      computeProposers(state, state.epochCtx.nextShuffling, state.effectiveBalances);
    },
  });

  itBench({
    id: `computeEpochShuffling - vc ${numValidators}`,
    fn: () => {
      computeEpochShuffling(state, state.epochCtx.nextShuffling.activeIndices, nextEpoch);
    },
  });

  itBench({
    id: `getNextSyncCommittee - vc ${numValidators}`,
    fn: () => {
      getNextSyncCommittee(state, state.epochCtx.nextShuffling.activeIndices, state.effectiveBalances);
    },
  });
});
