import {itBench} from "@dapplion/benchmark";
import {Epoch} from "@lodestar/types";
import {DOMAIN_BEACON_PROPOSER} from "@lodestar/params";
import {
  computeEpochAtSlot,
  CachedBeaconStateAllForks,
  computeEpochShuffling,
  getNextSyncCommittee,
  computeProposers,
  getSeed,
} from "../../../src/index.js";
import {generatePerfTestCachedStatePhase0, numValidators} from "../util.js";

describe("epoch shufflings", () => {
  let state: CachedBeaconStateAllForks;
  let nextEpoch: Epoch;

  before(function () {
    this.timeout(60 * 1000);
    state = generatePerfTestCachedStatePhase0();
    nextEpoch = computeEpochAtSlot(state.slot) + 1;

    // Sanity check to ensure numValidators doesn't go stale
    if (state.validators.length !== numValidators) throw Error("constant numValidators is wrong");
  });

  itBench({
    id: `computeProposers - vc ${numValidators}`,
    fn: () => {
      const epochSeed = getSeed(state, state.epochCtx.epoch, DOMAIN_BEACON_PROPOSER);
      const fork = state.config.getForkSeq(state.slot);
      computeProposers(fork, epochSeed, state.epochCtx.currentShuffling, state.epochCtx.effectiveBalanceIncrements);
    },
  });

  itBench({
    id: `computeEpochShuffling - vc ${numValidators}`,
    fn: () => {
      const {nextActiveIndices} = state.epochCtx;
      computeEpochShuffling(state, nextActiveIndices, nextEpoch);
    },
  });

  itBench({
    id: `getNextSyncCommittee - vc ${numValidators}`,
    fn: () => {
      const fork = state.config.getForkSeq(state.slot);
      getNextSyncCommittee(fork, state, state.epochCtx.nextActiveIndices, state.epochCtx.effectiveBalanceIncrements);
    },
  });
});
