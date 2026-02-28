import {ChainConfig} from "@lodestar/config";
import {GENESIS_SLOT} from "@lodestar/params";
import {Epoch, Slot, TimeSeconds} from "@lodestar/types";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "./epoch.js";

/**
 * Get the slot duration in milliseconds for a given slot.
 * Pre-EIP7782: uses SLOT_DURATION_MS (12000ms on mainnet)
 * Post-EIP7782: uses SLOT_DURATION_MS_EIP7782 (6000ms)
 */
export function getSlotDurationMs(config: ChainConfig, slot: Slot): number {
  const epoch = computeEpochAtSlot(slot);
  return epoch >= config.EIP7782_FORK_EPOCH ? config.SLOT_DURATION_MS_EIP7782 : config.SLOT_DURATION_MS;
}

/**
 * Get the slot duration in milliseconds for a given epoch.
 */
export function getSlotDurationMsAtEpoch(config: ChainConfig, epoch: Epoch): number {
  return epoch >= config.EIP7782_FORK_EPOCH ? config.SLOT_DURATION_MS_EIP7782 : config.SLOT_DURATION_MS;
}

/**
 * Compute the time (in seconds) at which a given slot starts.
 *
 * Pre-EIP7782 fork: time = genesisTime + slot * (SLOT_DURATION_MS / 1000)
 * Post-EIP7782 fork: time = forkTime + (slot - forkSlot) * (SLOT_DURATION_MS_EIP7782 / 1000)
 *
 * This is a piecewise function that changes rate at the fork boundary.
 */
export function computeTimeAtSlot(config: ChainConfig, slot: Slot, genesisTime: TimeSeconds): TimeSeconds {
  const forkSlot = computeStartSlotAtEpoch(config.EIP7782_FORK_EPOCH);

  if (slot < forkSlot) {
    return genesisTime + slot * (config.SLOT_DURATION_MS / 1000);
  }

  const forkTime = genesisTime + forkSlot * (config.SLOT_DURATION_MS / 1000);
  return forkTime + (slot - forkSlot) * (config.SLOT_DURATION_MS_EIP7782 / 1000);
}

/**
 * Get the number of slots since genesis, accounting for the slot duration change at EIP-7782 fork.
 */
export function getSlotsSinceGenesis(config: ChainConfig, genesisTime: TimeSeconds): Slot {
  const nowSec = Date.now() / 1000;
  const diffSec = nowSec - genesisTime;

  const forkSlot = computeStartSlotAtEpoch(config.EIP7782_FORK_EPOCH);
  const forkTimeSec = forkSlot * (config.SLOT_DURATION_MS / 1000);

  if (diffSec < forkTimeSec) {
    return Math.floor(diffSec / (config.SLOT_DURATION_MS / 1000));
  }

  const postForkSec = diffSec - forkTimeSec;
  return forkSlot + Math.floor(postForkSec / (config.SLOT_DURATION_MS_EIP7782 / 1000));
}

export function getCurrentSlot(config: ChainConfig, genesisTime: TimeSeconds): Slot {
  return GENESIS_SLOT + getSlotsSinceGenesis(config, genesisTime);
}

export function computeSlotsSinceEpochStart(slot: Slot, epoch?: Epoch): Slot {
  const computeEpoch = epoch ?? computeEpochAtSlot(slot);
  return slot - computeStartSlotAtEpoch(computeEpoch);
}
