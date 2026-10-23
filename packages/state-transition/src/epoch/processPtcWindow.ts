import {ForkSeq, MIN_SEED_LOOKAHEAD, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {CachedBeaconStateEip8453, CachedBeaconStateGloas, EpochTransitionCache} from "../types.js";
import {computePtcEip8453} from "../util/eip8453.js";
import {computeStartSlotAtEpoch} from "../util/epoch.js";
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

  const newNextPayloadTimelinessCommittees =
    state.config.getForkSeq(state.slot) >= ForkSeq.eip8453
      ? // [Modified in EIP8453] compute_ptc samples the active validators directly, shuffled by the slot seed
        Array.from({length: SLOTS_PER_EPOCH}, (_, i) =>
          computePtcEip8453(
            state as unknown as CachedBeaconStateEip8453,
            computeStartSlotAtEpoch(nextEpoch) + i,
            nextEpochShuffling.activeIndices
          )
        )
      : computePayloadTimelinessCommitteesForEpoch(
          state,
          nextEpoch,
          nextEpochShuffling.committees,
          nextEpochShuffling.shuffling,
          state.epochCtx.effectiveBalanceIncrements
        );

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
