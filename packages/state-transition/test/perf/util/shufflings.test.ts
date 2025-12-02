import {beforeAll, bench, describe} from "@chainsafe/benchmark";
import {DOMAIN_BEACON_PROPOSER} from "@lodestar/params";
import {Epoch} from "@lodestar/types";
import {
  CachedBeaconStateAllForks,
  computeEpochAtSlot,
  computeEpochShuffling,
  computeProposers,
  getNextSyncCommittee,
  getSeed,
} from "../../../src/index.js";
import {generatePerfTestCachedStatePhase0, numValidators} from "../util.js";

describe("epoch shufflings", () => {
  let state: CachedBeaconStateAllForks;
  let nextEpoch: Epoch;

  beforeAll(() => {
    state = generatePerfTestCachedStatePhase0();
    nextEpoch = computeEpochAtSlot(state.slot) + 1;

    // Sanity check to ensure numValidators doesn't go stale
    if (state.validators.length !== numValidators) throw Error("constant numValidators is wrong");
  }, 60 * 1000);

  bench({
    id: `computeProposers - vc ${numValidators}`,
    fn: () => {
      const epochSeed = getSeed(state, state.epochCtx.epoch, DOMAIN_BEACON_PROPOSER);
      const fork = state.config.getForkSeq(state.slot);
      computeProposers(fork, epochSeed, state.epochCtx.currentShuffling, state.epochCtx.effectiveBalanceIncrements);
    },
  });

  bench({
    id: `computeEpochShuffling - vc ${numValidators}`,
    fn: () => {
      const {nextActiveIndices} = state.epochCtx;
      computeEpochShuffling(state, nextActiveIndices, nextEpoch);
    },
  });

  bench({
    id: `getNextSyncCommittee - vc ${numValidators}`,
    fn: () => {
      const fork = state.config.getForkSeq(state.slot);
      getNextSyncCommittee(fork, state, state.epochCtx.nextActiveIndices, state.epochCtx.effectiveBalanceIncrements);
    },
  });
});
