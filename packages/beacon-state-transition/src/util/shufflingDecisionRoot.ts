import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconState} from "@chainsafe/lodestar-types/lib/allForks";
import {Epoch, Root, Slot} from "../phase0";
import {getBlockRootAtSlot} from "./blockRoot";
import {computeEpochAtSlot, computeStartSlotAtEpoch, getCurrentEpoch, getPreviousEpoch} from "./epoch";

/**
 * Returns the block root which decided the proposer shuffling for the current epoch. This root
 * can be used to key this proposer shuffling.
 *
 * Returns `null` on the one-off scenario where the genesis block decides its own shuffling.
 * It should be set to the latest block applied to this `state` or the genesis block root.
 */
export function proposerShufflingDecisionRoot(config: IBeaconConfig, state: BeaconState): Root | null {
  const decisionSlot = proposerShufflingDecisionSlot(config, state);
  if (state.slot == decisionSlot) {
    return null;
  } else {
    return getBlockRootAtSlot(config, state, decisionSlot);
  }
}

/**
 * Returns the slot at which the proposer shuffling was decided. The block root at this slot
 * can be used to key the proposer shuffling for the current epoch.
 */
function proposerShufflingDecisionSlot(config: IBeaconConfig, state: BeaconState): Slot {
  const epoch = computeEpochAtSlot(config, state.slot);
  const startSlot = computeStartSlotAtEpoch(config, epoch);
  return Math.max(startSlot - 1, 0);
}

/**
 * Returns the block root which decided the attester shuffling for the given `requestedEpoch`.
 * This root can be used to key that attester shuffling.
 *
 * Returns `null` on the one-off scenario where the genesis block decides its own shuffling.
 * It should be set to the latest block applied to this `state` or the genesis block root.
 */
export function attesterShufflingDecisionRoot(
  config: IBeaconConfig,
  state: BeaconState,
  requestedEpoch: Epoch
): Root | null {
  const decisionSlot = attesterShufflingDecisionSlot(config, state, requestedEpoch);
  if (state.slot == decisionSlot) {
    return null;
  } else {
    return getBlockRootAtSlot(config, state, decisionSlot);
  }
}

/**
 * Returns the slot at which the proposer shuffling was decided. The block root at this slot
 * can be used to key the proposer shuffling for the current epoch.
 */
function attesterShufflingDecisionSlot(config: IBeaconConfig, state: BeaconState, requestedEpoch: Epoch): Slot {
  const epoch = attesterShufflingDecisionEpoch(config, state, requestedEpoch);
  const slot = computeStartSlotAtEpoch(config, epoch);
  return Math.max(slot - 1, 0);
}

/**
 * Returns the epoch at which the proposer shuffling was decided.
 *
 * Throws an error when:
 * - `EpochTooLow` when `requestedEpoch` is more than 1 prior to `currentEpoch`.
 * - `EpochTooHigh` when `requestedEpoch` is more than 1 after `currentEpoch`.
 */
function attesterShufflingDecisionEpoch(config: IBeaconConfig, state: BeaconState, requestedEpoch: Epoch): Epoch {
  const currentEpoch = getCurrentEpoch(config, state);

  // Next
  if (requestedEpoch === currentEpoch + 1) return getCurrentEpoch(config, state);
  // Current
  if (requestedEpoch === currentEpoch) return getPreviousEpoch(config, state);
  // Previous
  if (requestedEpoch === currentEpoch - 1) return Math.max(getPreviousEpoch(config, state) - 1, 0);

  if (requestedEpoch < currentEpoch) {
    throw Error(`EpochTooLow: current ${currentEpoch} requested ${requestedEpoch}`);
  } else {
    throw Error(`EpochTooHigh: current ${currentEpoch} requested ${requestedEpoch}`);
  }
}
