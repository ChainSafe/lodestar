import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Epoch, Slot, SyncPeriod} from "@chainsafe/lodestar-types";

/**
 * Return the epoch number at the given slot.
 */
export function computeEpochAtSlot(config: IBeaconConfig, slot: Slot): Epoch {
  return Math.floor(slot / config.params.SLOTS_PER_EPOCH);
}

/**
 * Return the sync committee period at slot
 */
export function computeSyncPeriodAtSlot(config: IBeaconConfig, slot: Slot): SyncPeriod {
  return computeSyncPeriodAtEpoch(config, computeEpochAtSlot(config, slot));
}

/**
 * Return the sync committee period at epoch
 */
export function computeSyncPeriodAtEpoch(config: IBeaconConfig, epoch: Epoch): SyncPeriod {
  return Math.floor(epoch / config.params.EPOCHS_PER_SYNC_COMMITTEE_PERIOD);
}
