import {IChainConfig} from "@chainsafe/lodestar-config";
import {GENESIS_SLOT, INTERVALS_PER_SLOT} from "@chainsafe/lodestar-params";
import {Number64, Slot, Epoch} from "@chainsafe/lodestar-types";
import {computeStartSlotAtEpoch, computeEpochAtSlot} from ".";

export function getSlotsSinceGenesis(config: IChainConfig, genesisTime: Number64): Slot {
  const diffInSeconds = Date.now() / 1000 - genesisTime;
  return Math.floor(diffInSeconds / config.SECONDS_PER_SLOT);
}

export function getCurrentSlot(config: IChainConfig, genesisTime: Number64): Slot {
  return GENESIS_SLOT + getSlotsSinceGenesis(config, genesisTime);
}

export function computeSlotsSinceEpochStart(slot: Slot, epoch?: Epoch): number {
  const computeEpoch = epoch ?? computeEpochAtSlot(slot);
  return slot - computeStartSlotAtEpoch(computeEpoch);
}

export function computeTimeAtSlot(config: IChainConfig, slot: Slot, genesisTime: Number64): Number64 {
  return genesisTime + slot * config.SECONDS_PER_SLOT;
}

export function getCurrentInterval(config: IChainConfig, genesisTime: Number64, secondsIntoSlot: number): number {
  const timePerInterval = Math.floor(config.SECONDS_PER_SLOT / INTERVALS_PER_SLOT);
  return Math.floor(secondsIntoSlot / timePerInterval);
}
