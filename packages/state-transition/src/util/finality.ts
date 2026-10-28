import {ForkSeq, MIN_EPOCHS_TO_INACTIVITY_PENALTY} from "@lodestar/params";
import {Epoch, Slot} from "@lodestar/types";
import {CachedBeaconStateAllForks, CachedBeaconStateEip8453, CachedBeaconStatePreEip8453} from "../types.js";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "./epoch.js";

/**
 * The epoch of the last finalized block. Before EIP8453 it is `state.finalized_checkpoint.epoch`; from EIP8453
 * the finalized checkpoint is a height checkpoint and the spec reads `compute_epoch_at_slot(state.finalized_slot)`.
 */
export function getFinalizedEpoch(state: CachedBeaconStateAllForks): Epoch {
  return state.config.getForkSeq(state.slot) >= ForkSeq.eip8453
    ? computeEpochAtSlot((state as CachedBeaconStateEip8453).finalizedSlot)
    : (state as CachedBeaconStatePreEip8453).finalizedCheckpoint.epoch;
}

/**
 * The slot up to which deposits and other finalized-only data may be consumed. Before EIP8453 it is the start of
 * the finalized epoch; from EIP8453 the spec reads `state.finalized_slot` exactly.
 */
export function getFinalizedSlot(state: CachedBeaconStateAllForks): Slot {
  return state.config.getForkSeq(state.slot) >= ForkSeq.eip8453
    ? (state as CachedBeaconStateEip8453).finalizedSlot
    : computeStartSlotAtEpoch((state as CachedBeaconStatePreEip8453).finalizedCheckpoint.epoch);
}

export function getFinalityDelay(state: CachedBeaconStateAllForks): number {
  // previousEpoch = epoch - 1
  return state.epochCtx.epoch - 1 - getFinalizedEpoch(state);
}

/**
 * If the chain has not been finalized for >4 epochs, the chain enters an "inactivity leak" mode,
 * where inactive validators get progressively penalized more and more, to reduce their influence
 * until blocks get finalized again. See here (https://github.com/ethereum/annotated-spec/blob/master/phase0/beacon-chain.md#inactivity-quotient) for what the inactivity leak is, what it's for and how
 * it works.
 */
export function isInInactivityLeak(state: CachedBeaconStateAllForks): boolean {
  return getFinalityDelay(state) > MIN_EPOCHS_TO_INACTIVITY_PENALTY;
}
