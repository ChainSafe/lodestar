import {ChainConfig} from "@lodestar/config";
import {EPOCHS_PER_SYNC_COMMITTEE_PERIOD, SLOTS_PER_EPOCH} from "@lodestar/params";
import {Epoch, Slot, SyncPeriod} from "@lodestar/types";

export function getCurrentSlot(config: ChainConfig, genesisTime: number): Slot {
  const diffInSeconds = Date.now() / 1000 - genesisTime;
  return Math.floor(diffInSeconds / config.SECONDS_PER_SLOT);
}

/** Returns the slot if the internal clock were advanced by `toleranceSec`. */
export function slotWithFutureTolerance(config: ChainConfig, genesisTime: number, toleranceSec: number): Slot {
  // this is the same to getting slot at now + toleranceSec
  return getCurrentSlot(config, genesisTime - toleranceSec);
}

/**
 * Return the epoch number at the given slot.
 */
export function computeEpochAtSlot(slot: Slot): Epoch {
  return Math.floor(slot / SLOTS_PER_EPOCH);
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

export function timeUntilNextEpoch(config: Pick<ChainConfig, "SECONDS_PER_SLOT">, genesisTime: number): number {
  const milliSecondsPerEpoch = SLOTS_PER_EPOCH * config.SECONDS_PER_SLOT * 1000;
  const msFromGenesis = Date.now() - genesisTime * 1000;
  if (msFromGenesis >= 0) {
    return milliSecondsPerEpoch - (msFromGenesis % milliSecondsPerEpoch);
  } else {
    return Math.abs(msFromGenesis % milliSecondsPerEpoch);
  }
}
