import {EPOCHS_PER_SYNC_COMMITTEE_PERIOD, GENESIS_EPOCH, MAX_SEED_LOOKAHEAD, SLOTS_PER_EPOCH} from "@lodestar/params";
import {allForks, Epoch, Slot, SyncPeriod} from "@lodestar/types";

/**
 * Return the epoch number at the given slot.
 */
export function computeEpochAtSlot(slot: Slot): Epoch {
  return Math.floor(slot / SLOTS_PER_EPOCH);
}

/**
 * Return the epoch at the state slot for purposes of checkpoint.
 * Ideally this slot % SLOTS_PER_EPOCH === 0, but just to handle the improbable case of
 * non boundary slot, using ceil so that the state's latestBlockHeader would always
 * lie before this epooch
 */
export function computeCheckpointEpochAtStateSlot(slot: Slot): Epoch {
  return Math.ceil(slot / SLOTS_PER_EPOCH);
}

/**
 * Return the starting slot of the given epoch.
 */
export function computeStartSlotAtEpoch(epoch: Epoch): Slot {
  return epoch * SLOTS_PER_EPOCH;
}

/**
 * Return the end slot of the given epoch.
 */
export function computeEndSlotAtEpoch(epoch: Epoch): Slot {
  return computeStartSlotAtEpoch(epoch + 1) - 1;
}

/**
 * Return the epoch at which an activation or exit triggered in ``epoch`` takes effect.
 */
export function computeActivationExitEpoch(epoch: Epoch): Epoch {
  return epoch + 1 + MAX_SEED_LOOKAHEAD;
}

/**
 * Return the current epoch of the given state.
 */
export function getCurrentEpoch(state: Pick<allForks.BeaconState, "slot">): Epoch {
  return computeEpochAtSlot(state.slot);
}

/**
 * Return the previous epoch of the given state.
 */
export function getPreviousEpoch(state: Pick<allForks.BeaconState, "slot">): Epoch {
  const currentEpoch = getCurrentEpoch(state);
  if (currentEpoch === GENESIS_EPOCH) {
    return GENESIS_EPOCH;
  }
  return currentEpoch - 1;
}

/**
 * Return the sync committee period at slot
 */
export function computeSyncPeriodAtSlot(slot: Slot): SyncPeriod {
  return computeSyncPeriodAtEpoch(computeEpochAtSlot(slot));
}

/**
 * Return the sync committee period at epoch
 */
export function computeSyncPeriodAtEpoch(epoch: Epoch): SyncPeriod {
  return Math.floor(epoch / EPOCHS_PER_SYNC_COMMITTEE_PERIOD);
}
