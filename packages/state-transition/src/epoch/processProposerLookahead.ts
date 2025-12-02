import {ForkSeq, MIN_SEED_LOOKAHEAD, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {CachedBeaconStateFulu, EpochTransitionCache} from "../types.js";
import {computeEpochShuffling} from "../util/epochShuffling.js";
import {computeProposerIndices} from "../util/seed.js";

/**
 * This function updates the `proposer_lookahead` field in the beacon state
 * by shifting out proposer indices from the earliest epoch and appending new
 * proposer indices for the latest epoch. With `MIN_SEED_LOOKAHEAD` set to `1`,
 * this means that at the start of epoch `N`, the proposer lookahead for epoch
 * `N+1` will be computed and included in the beacon state's lookahead.
 */
export function processProposerLookahead(
  fork: ForkSeq,
  state: CachedBeaconStateFulu,
  cache: EpochTransitionCache
): void {
  // Shift out proposers in the first epoch
  const remainingProposerLookahead = state.proposerLookahead.getAll().slice(SLOTS_PER_EPOCH);

  // Fill in the last epoch with new proposer indices
  const epoch = state.epochCtx.epoch + MIN_SEED_LOOKAHEAD + 1;

  const shuffling =
    state.epochCtx.shufflingCache?.getSync(epoch, cache.nextShufflingDecisionRoot, {
      state,
      activeIndices: cache.nextShufflingActiveIndices,
    }) ??
    // Only for testing. shufflingCache should always be available in prod
    computeEpochShuffling(state, cache.nextShufflingActiveIndices, epoch);

  const lastEpochProposerLookahead = computeProposerIndices(fork, state, shuffling, epoch);

  state.proposerLookahead = ssz.fulu.ProposerLookahead.toViewDU([
    ...remainingProposerLookahead,
    ...lastEpochProposerLookahead,
  ]);
}
