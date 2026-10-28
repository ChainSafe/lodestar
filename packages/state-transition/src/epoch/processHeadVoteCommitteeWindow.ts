import {MIN_SEED_LOOKAHEAD, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {CachedBeaconStateEip8453, EpochTransitionCache} from "../types.js";
import {computeHeadVoteCommittee} from "../util/eip8453.js";
import {computeStartSlotAtEpoch} from "../util/epoch.js";
import {computeEpochShuffling} from "../util/epochShuffling.js";

/**
 * Spec: process_head_vote_committee_window [New in EIP8453]
 *
 * Shift the window of head vote committees by one epoch and sample the committees of the new lookahead epoch,
 * like `process_ptc_window`. The window keeps the previous, current and `MIN_SEED_LOOKAHEAD` next epochs so
 * that a vote of the previous epoch is checked against the committee it was sampled for.
 */
export function processHeadVoteCommitteeWindow(state: CachedBeaconStateEip8453, cache: EpochTransitionCache): void {
  const nextEpoch = state.epochCtx.epoch + MIN_SEED_LOOKAHEAD + 1;
  const nextEpochShuffling =
    cache.nextShuffling ?? computeEpochShuffling(state, cache.nextShufflingActiveIndices, nextEpoch);
  cache.nextShuffling = nextEpochShuffling;
  const startSlot = computeStartSlotAtEpoch(nextEpoch);

  const window = state.headVoteCommitteeWindow;
  const retainedLength = window.length - SLOTS_PER_EPOCH;
  for (let i = 0; i < retainedLength; i++) {
    window.set(i, window.getReadonly(i + SLOTS_PER_EPOCH));
  }
  for (let i = 0; i < SLOTS_PER_EPOCH; i++) {
    const committee = computeHeadVoteCommittee(state, startSlot + i, nextEpochShuffling.activeIndices);
    window.set(retainedLength + i, ssz.eip8453.HeadVoteCommittee.toViewDU(Array.from(committee)));
  }
}
