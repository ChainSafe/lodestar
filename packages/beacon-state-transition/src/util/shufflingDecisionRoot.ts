import {Epoch, Root, Slot} from "@chainsafe/lodestar-types";
import {CachedBeaconStateAllForks} from "../types.js";
import {getBlockRootAtSlot} from "./blockRoot.js";
import {computeStartSlotAtEpoch} from "./epoch.js";

/**
 * Returns the block root which decided the proposer shuffling for the current epoch. This root
 * can be used to key this proposer shuffling.
 *
 * Returns `null` on the one-off scenario where the genesis block decides its own shuffling.
 * It should be set to the latest block applied to this `state` or the genesis block root.
 */
export function proposerShufflingDecisionRoot(state: CachedBeaconStateAllForks): Root | null {
  const decisionSlot = proposerShufflingDecisionSlot(state);
  if (state.slot == decisionSlot) {
    return null;
  } else {
    return getBlockRootAtSlot(state, decisionSlot);
  }
}

/**
 * Returns the slot at which the proposer shuffling was decided. The block root at this slot
 * can be used to key the proposer shuffling for the current epoch.
 */
function proposerShufflingDecisionSlot(state: CachedBeaconStateAllForks): Slot {
  const startSlot = computeStartSlotAtEpoch(state.epochCtx.epoch);
  return Math.max(startSlot - 1, 0);
}

/**
 * Returns the block root which decided the attester shuffling for the given `requestedEpoch`.
 * This root can be used to key that attester shuffling.
 *
 * Returns `null` on the one-off scenario where the genesis block decides its own shuffling.
 * It should be set to the latest block applied to this `state` or the genesis block root.
 */
export function attesterShufflingDecisionRoot(state: CachedBeaconStateAllForks, requestedEpoch: Epoch): Root | null {
  const decisionSlot = attesterShufflingDecisionSlot(state, requestedEpoch);
  if (state.slot == decisionSlot) {
    return null;
  } else {
    return getBlockRootAtSlot(state, decisionSlot);
  }
}

/**
 * Returns the slot at which the proposer shuffling was decided. The block root at this slot
 * can be used to key the proposer shuffling for the current epoch.
 */
function attesterShufflingDecisionSlot(state: CachedBeaconStateAllForks, requestedEpoch: Epoch): Slot {
  const epoch = attesterShufflingDecisionEpoch(state, requestedEpoch);
  const slot = computeStartSlotAtEpoch(epoch);
  return Math.max(slot - 1, 0);
}

/**
 * Returns the epoch at which the attester shuffling was decided.
 *
 * Spec ref: https://github.com/ethereum/beacon-APIs/blob/v2.1.0/apis/validator/duties/attester.yaml#L15
 *
 * Throws an error when:
 * - `EpochTooLow` when `requestedEpoch` is more than 1 prior to `currentEpoch`.
 * - `EpochTooHigh` when `requestedEpoch` is more than 1 after `currentEpoch`.
 */
function attesterShufflingDecisionEpoch(state: CachedBeaconStateAllForks, requestedEpoch: Epoch): Epoch {
  const currentEpoch = state.epochCtx.epoch;

  // Next
  if (requestedEpoch === currentEpoch + 1) return currentEpoch;
  // Current
  if (requestedEpoch === currentEpoch) return Math.max(currentEpoch - 1, 0);
  // Previous
  if (requestedEpoch === currentEpoch - 1) return Math.max(currentEpoch - 2, 0);

  if (requestedEpoch < currentEpoch) {
    throw Error(`EpochTooLow: current ${currentEpoch} requested ${requestedEpoch}`);
  } else {
    throw Error(`EpochTooHigh: current ${currentEpoch} requested ${requestedEpoch}`);
  }
}
