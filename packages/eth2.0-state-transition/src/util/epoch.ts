/**
 * @module chain/stateTransition/util
 */

import {
  Epoch,
  Slot,
  BeaconState,
} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {GENESIS_EPOCH} from "../constants";

/**
 * Return the epoch number at the given slot.
 */
export function computeEpochAtSlot(config: IBeaconConfig, slot: Slot): Epoch {
  return Math.floor(slot / config.params.SLOTS_PER_EPOCH);
}

/**
 * Return the starting slot of the given epoch.
 */
export function computeStartSlotAtEpoch(config: IBeaconConfig, epoch: Epoch): Slot {
  return epoch * config.params.SLOTS_PER_EPOCH;
}

/**
 * Return the epoch at which an activation or exit triggered in ``epoch`` takes effect.
 */
export function computeActivationExitEpoch(config: IBeaconConfig, epoch: Epoch): Epoch {
  return epoch + 1 + config.params.MAX_SEED_LOOKAHEAD;
}

/**
 * Return the current epoch of the given state.
 */
export function getCurrentEpoch(config: IBeaconConfig, state: BeaconState): Epoch {
  return computeEpochAtSlot(config, state.slot);
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
