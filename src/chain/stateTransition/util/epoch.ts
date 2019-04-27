import {
  ACTIVATION_EXIT_DELAY,
  GENESIS_EPOCH,
  SLOTS_PER_EPOCH,
} from "../../../constants";

import {
  BeaconState,
  Epoch,
  Slot,
} from "../../../types";

/**
 * Return the epoch number of the given slot.
 * @param {Slot} slot
 * @returns {Epoch}
 */
export function slotToEpoch(slot: Slot): Epoch {
  return Math.floor(slot / SLOTS_PER_EPOCH);
}

/**
 * Return the previous epoch of the given state.
 * @param {BeaconState} state
 * @returns {Epoch}
 */
export function getPreviousEpoch(state: BeaconState): Epoch {
  const currentEpoch = getCurrentEpoch(state);
  if (currentEpoch === GENESIS_EPOCH) {
    return GENESIS_EPOCH;
  }
  return currentEpoch - 1;
}

/**
 * Return the current epoch of the given state.
 * @param {BeaconState} state
 * @returns {Epoch}
 */
export function getCurrentEpoch(state: BeaconState): Epoch {
  return slotToEpoch(state.slot);
}

/**
 * Return the starting slot of the given epoch.
 * @param {Epoch} epoch
 * @returns {Slot}
 */
export function getEpochStartSlot(epoch: Epoch): Slot {
  return epoch * SLOTS_PER_EPOCH;
}

/**
 * Return the epoch at which an activation or exit triggered in ``epoch`` takes effect.
 * @param {Epoch} epoch
 * @returns {Epoch}
 */
export function getDelayedActivationExitEpoch(epoch: Epoch): Epoch {
  return epoch + 1 + ACTIVATION_EXIT_DELAY;
}
