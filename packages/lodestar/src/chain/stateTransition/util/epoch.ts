/**
 * @module chain/stateTransition/util
 */

import {
  ACTIVATION_EXIT_DELAY,
  GENESIS_EPOCH,
  SLOTS_PER_EPOCH,
} from "@chainsafe/eth2-types"

import {
  BeaconState,
  Epoch,
  Slot,
} from "@chainsafe/eth2-types";

/**
 * Return the epoch number of the given slot.
 */
export function slotToEpoch(slot: Slot): Epoch {
  return Math.floor(slot / SLOTS_PER_EPOCH);
}

/**
 * Return the previous epoch of the given state.
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
 */
export function getCurrentEpoch(state: BeaconState): Epoch {
  return slotToEpoch(state.slot);
}

/**
 * Return the starting slot of the given epoch.
 */
export function getEpochStartSlot(epoch: Epoch): Slot {
  return epoch * SLOTS_PER_EPOCH;
}

/**
 * Return the epoch at which an activation or exit triggered in ``epoch`` takes effect.
 */
export function getDelayedActivationExitEpoch(epoch: Epoch): Epoch {
  return epoch + 1 + ACTIVATION_EXIT_DELAY;
}
