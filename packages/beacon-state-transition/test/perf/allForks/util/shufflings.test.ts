import {itBench} from "@dapplion/benchmark";
import {Epoch} from "@chainsafe/lodestar-types";
import {DOMAIN_BEACON_PROPOSER} from "@chainsafe/lodestar-params";
import {
  computeEpochAtSlot,
  CachedBeaconStateAllForks,
  computeEpochShuffling,
  getNextSyncCommittee,
  computeProposers,
  getSeed,
} from "../../../../src/index.js";
import {generatePerfTestCachedStatePhase0, numValidators} from "../../util.js";

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
      const epochSeed = getSeed(state, state.epochCtx.nextShuffling.epoch, DOMAIN_BEACON_PROPOSER);
      computeProposers(epochSeed, state.epochCtx.nextShuffling, state.epochCtx.effectiveBalanceIncrements);
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
      getNextSyncCommittee(
        state,
        state.epochCtx.nextShuffling.activeIndices,
        state.epochCtx.effectiveBalanceIncrements
      );
    },
  });
});
