import {MIN_SEED_LOOKAHEAD} from "@lodestar/params";
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
    state.epochCtx.effectiveBalanceIncrements
  );

  // Stash for finalProcessEpoch to shift into epoch cache
  cache.nextEpochPayloadTimelinessCommittees = newNextPayloadTimelinessCommittees;

  // Write shifted window to state: current(N) + next(N+1) + newlyComputed(N+2)
  // From the perspective of upcoming epoch N+1, this is previous + current + next
  state.ptcWindow = ssz.gloas.PtcWindow.toViewDU([
    ...state.epochCtx.payloadTimelinessCommittees,
    ...state.epochCtx.nextPayloadTimelinessCommittees,
    ...newNextPayloadTimelinessCommittees,
  ]);
}
