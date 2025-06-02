import {ForkSeq, MIN_SEED_LOOKAHEAD, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {CachedBeaconStateFulu} from "../types.js";
import {computeProposerIndices} from "../util/seed.js";

/**
 * This function updates the `proposer_lookahead` field in the beacon state
 * by shifting out proposer indices from the earliest epoch and appending new
 * proposer indices for the latest epoch. With `MIN_SEED_LOOKAHEAD` set to `1`,
 * this means that at the start of epoch `N`, the proposer lookahead for epoch
 * `N+1` will be computed and included in the beacon state's lookahead.
 */
export function processProposerLookahead(fork: ForkSeq, state: CachedBeaconStateFulu): void {
  // Shift out proposers in the first epoch
  const remainingProposerLookahead = state.proposerLookahead.getAll().slice(SLOTS_PER_EPOCH);

  // Fill in the last epoch with new proposer indices
  const lastEpochProposerLookahead = computeProposerIndices(fork, state, state.epochCtx.epoch + MIN_SEED_LOOKAHEAD + 1);

  state.proposerLookahead = ssz.fulu.ProposerLookahead.toViewDU([
    ...remainingProposerLookahead,
    ...lastEpochProposerLookahead,
  ]);
}
