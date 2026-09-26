import {ChainConfig} from "@lodestar/config";
import {GENESIS_SLOT} from "@lodestar/params";
import {Epoch, Slot, TimeSeconds} from "@lodestar/types";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "./epoch.js";

/** Slot duration in ms for a given slot */
export function getSlotDurationMs(config: ChainConfig, _slot: Slot): number {
  return config.SLOT_DURATION_MS;
}

export function getSlotsSinceGenesis(config: ChainConfig, genesisTime: TimeSeconds): Slot {
  const diffInSeconds = Date.now() / 1000 - genesisTime;
  return Math.floor(diffInSeconds / (config.SLOT_DURATION_MS / 1000));
}

export function getCurrentSlot(config: ChainConfig, genesisTime: TimeSeconds): Slot {
  return GENESIS_SLOT + getSlotsSinceGenesis(config, genesisTime);
}

export function computeSlotsSinceEpochStart(slot: Slot, epoch?: Epoch): Slot {
  const computeEpoch = epoch ?? computeEpochAtSlot(slot);
  return slot - computeStartSlotAtEpoch(computeEpoch);
}

export function computeTimeAtSlot(config: ChainConfig, slot: Slot, genesisTime: TimeSeconds): TimeSeconds {
  return genesisTime + slot * (config.SLOT_DURATION_MS / 1000);
}
