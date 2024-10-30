import {EPOCHS_PER_SYNC_COMMITTEE_PERIOD, GENESIS_EPOCH, MAX_SEED_LOOKAHEAD, SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconState, Epoch, Gwei, Slot, SyncPeriod} from "@lodestar/types";
import {CachedBeaconStateElectra} from "../types.js";
import {getActivationExitChurnLimit, getConsolidationChurnLimit} from "./validator.js";

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

export function computeExitEpochAndUpdateChurn(state: CachedBeaconStateElectra, exitBalance: Gwei): number {
  let earliestExitEpoch = Math.max(state.earliestExitEpoch, computeActivationExitEpoch(state.epochCtx.epoch));
  const perEpochChurn = getActivationExitChurnLimit(state.epochCtx);

  // New epoch for exits.
  let exitBalanceToConsume =
    state.earliestExitEpoch < earliestExitEpoch ? perEpochChurn : Number(state.exitBalanceToConsume);

  // Exit doesn't fit in the current earliest epoch.
  if (exitBalance > exitBalanceToConsume) {
    const balanceToProcess = Number(exitBalance) - exitBalanceToConsume;
    const additionalEpochs = Math.floor((balanceToProcess - 1) / perEpochChurn) + 1;
    earliestExitEpoch += additionalEpochs;
    exitBalanceToConsume += additionalEpochs * perEpochChurn;
  }

  // Consume the balance and update state variables.
  state.exitBalanceToConsume = BigInt(exitBalanceToConsume) - exitBalance;
  state.earliestExitEpoch = earliestExitEpoch;

  return state.earliestExitEpoch;
}

export function computeConsolidationEpochAndUpdateChurn(
  state: CachedBeaconStateElectra,
  consolidationBalance: Gwei
): number {
  let earliestConsolidationEpoch = Math.max(
    state.earliestConsolidationEpoch,
    computeActivationExitEpoch(state.epochCtx.epoch)
  );
  const perEpochConsolidationChurn = getConsolidationChurnLimit(state.epochCtx);

  // New epoch for consolidations
  let consolidationBalanceToConsume =
    state.earliestConsolidationEpoch < earliestConsolidationEpoch
      ? perEpochConsolidationChurn
      : Number(state.consolidationBalanceToConsume);

  // Consolidation doesn't fit in the current earliest epoch.
  if (consolidationBalance > consolidationBalanceToConsume) {
    const balanceToProcess = Number(consolidationBalance) - consolidationBalanceToConsume;
    const additionalEpochs = Math.floor((balanceToProcess - 1) / perEpochConsolidationChurn) + 1;
    earliestConsolidationEpoch += additionalEpochs;
    consolidationBalanceToConsume += additionalEpochs * perEpochConsolidationChurn;
  }

  // Consume the balance and update state variables.
  state.consolidationBalanceToConsume = BigInt(consolidationBalanceToConsume) - consolidationBalance;
  state.earliestConsolidationEpoch = earliestConsolidationEpoch;

  return state.earliestConsolidationEpoch;
}

/**
 * Return the current epoch of the given state.
 */
export function getCurrentEpoch(state: Pick<BeaconState, "slot">): Epoch {
  return computeEpochAtSlot(state.slot);
}

/**
 * Return the previous epoch of the given state.
 */
export function getPreviousEpoch(state: Pick<BeaconState, "slot">): Epoch {
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

/**
 * Determine if the given slot is start slot of an epoch
 */
export function isStartSlotOfEpoch(slot: Slot): boolean {
  return slot % SLOTS_PER_EPOCH === 0;
}
