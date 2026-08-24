import {MIN_SEED_LOOKAHEAD, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {CachedBeaconStateGloas, EpochTransitionCache} from "../types.js";
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
  const nextEpochShuffling =
    cache.nextShuffling ?? computeEpochShuffling(state, cache.nextShufflingActiveIndices, nextEpoch);
  cache.nextShuffling = nextEpochShuffling;

  const newNextPayloadTimelinessCommittees = computePayloadTimelinessCommitteesForEpoch(
    state,
    nextEpoch,
    nextEpochShuffling.committees,
    state.epochCtx.effectiveBalanceIncrements,
    nextEpochShuffling.shuffling
  );

  // Stash for finalProcessEpoch to shift into epoch cache
  cache.nextEpochPayloadTimelinessCommittees = newNextPayloadTimelinessCommittees;

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
