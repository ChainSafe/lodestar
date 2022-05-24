import {IChainConfig} from "@chainsafe/lodestar-config";
import {GENESIS_SLOT, INTERVALS_PER_SLOT} from "@chainsafe/lodestar-params";
import {Slot, Epoch, TimeSeconds} from "@chainsafe/lodestar-types";
import {computeStartSlotAtEpoch, computeEpochAtSlot} from "./epoch.js";

export function getSlotsSinceGenesis(config: IChainConfig, genesisTime: TimeSeconds): Slot {
  const diffInSeconds = Date.now() / 1000 - genesisTime;
  return Math.floor(diffInSeconds / config.SECONDS_PER_SLOT);
}

export function getCurrentSlot(config: IChainConfig, genesisTime: TimeSeconds): Slot {
  return GENESIS_SLOT + getSlotsSinceGenesis(config, genesisTime);
}

export function computeSlotsSinceEpochStart(slot: Slot, epoch?: Epoch): Slot {
  const computeEpoch = epoch ?? computeEpochAtSlot(slot);
  return slot - computeStartSlotAtEpoch(computeEpoch);
}

export function computeTimeAtSlot(config: IChainConfig, slot: Slot, genesisTime: TimeSeconds): TimeSeconds {
  return genesisTime + slot * config.SECONDS_PER_SLOT;
}

export function getCurrentInterval(config: IChainConfig, secondsIntoSlot: number): number {
  const timePerInterval = Math.floor(config.SECONDS_PER_SLOT / INTERVALS_PER_SLOT);
  return Math.floor(secondsIntoSlot / timePerInterval);
}
