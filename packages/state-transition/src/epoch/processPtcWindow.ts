import {ForkSeq, MIN_SEED_LOOKAHEAD, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {
  CachedBeaconStateAllForks,
  CachedBeaconStateDecoupled,
  CachedBeaconStateGloas,
  EpochTransitionCache,
} from "../types.js";
import {computePtcForEpochDecoupled} from "../util/decoupled.js";
import {computeEpochShuffling} from "../util/epochShuffling.js";
import {computePayloadTimelinessCommitteesForEpoch} from "../util/seed.js";

/**
 * Update the `ptc_window` field in the beacon state by shifting out the oldest epoch's
 * PTC entries and appending newly computed entries for the next lookahead epoch.
 * Stashes the computed PTCs in the transition cache for finalProcessEpoch to shift
 * into the epoch cache without reading from state.
 *
 * Spec: https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.4/specs/gloas/beacon-chain.md#new-process_ptc_window
 */
export function processPtcWindow(state: CachedBeaconStateGloas, cache: EpochTransitionCache): void {
  const nextEpoch = state.epochCtx.epoch + MIN_SEED_LOOKAHEAD + 1;

  let newNextPayloadTimelinessCommittees: Uint32Array[];
  if (state.config.getForkSeq(state.slot) >= ForkSeq.decoupled) {
    // Spec: compute_ptc [Modified in DC] samples all active validators instead of the slot committees
    newNextPayloadTimelinessCommittees = computePtcForEpochDecoupled(
      state as CachedBeaconStateAllForks as CachedBeaconStateDecoupled,
      nextEpoch,
      cache.nextShufflingActiveIndices
    );
  } else {
    const nextEpochShuffling =
      cache.nextShuffling ?? computeEpochShuffling(state, cache.nextShufflingActiveIndices, nextEpoch);
    cache.nextShuffling = nextEpochShuffling;

    newNextPayloadTimelinessCommittees = computePayloadTimelinessCommitteesForEpoch(
      state,
      nextEpoch,
      nextEpochShuffling.committees,
      nextEpochShuffling.shuffling,
      state.epochCtx.effectiveBalanceIncrements
    );
  }

  // Stash for finalProcessEpoch to shift into epoch cache
  cache.nextEpochPayloadTimelinessCommittees = newNextPayloadTimelinessCommittees;

  // Shift the current and next epochs forward by reusing their SSZ subtrees and cached hashes.
  // Only the newly computed epoch needs new subtrees.
  const ptcWindow = state.ptcWindow;
  const retainedLength = ptcWindow.length - SLOTS_PER_EPOCH;
  for (let i = 0; i < retainedLength; i++) {
    ptcWindow.set(i, ptcWindow.getReadonly(i + SLOTS_PER_EPOCH));
  }
  for (let i = 0; i < SLOTS_PER_EPOCH; i++) {
    ptcWindow.set(
      retainedLength + i,
      ssz.gloas.PayloadTimelinessCommittee.toViewDU(newNextPayloadTimelinessCommittees[i])
    );
  }
}
