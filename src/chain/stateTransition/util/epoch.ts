/**
 * @module chain/stateTransition/util
 */

import {
  GENESIS_EPOCH,
} from "../../../constants";
import {
  BeaconState,
  Epoch,
  Slot,
} from "../../../types";
import {IBeaconConfig} from "../../../config";

/**
 * Return the epoch number of the given slot.
 */
export function slotToEpoch(config: IBeaconConfig, slot: Slot): Epoch {
  return Math.floor(slot / config.params.SLOTS_PER_EPOCH);
}

/**
 * Return the previous epoch of the given state.
 */
export function getPreviousEpoch(config: IBeaconConfig, state: BeaconState): Epoch {
  const currentEpoch = getCurrentEpoch(config, state);
  if (currentEpoch === GENESIS_EPOCH) {
    return GENESIS_EPOCH;
  }
  return currentEpoch - 1;
}

/**
 * Return the current epoch of the given state.
 */
export function getCurrentEpoch(config: IBeaconConfig, state: BeaconState): Epoch {
  return slotToEpoch(config, state.slot);
}

/**
 * Return the starting slot of the given epoch.
 */
export function getEpochStartSlot(config: IBeaconConfig, epoch: Epoch): Slot {
  return epoch * config.params.SLOTS_PER_EPOCH;
}

/**
 * Return the epoch at which an activation or exit triggered in ``epoch`` takes effect.
 */
export function getDelayedActivationExitEpoch(config: IBeaconConfig, epoch: Epoch): Epoch {
  return epoch + 1 + config.params.ACTIVATION_EXIT_DELAY;
}
