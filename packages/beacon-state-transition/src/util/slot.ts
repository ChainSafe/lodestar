import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {GENESIS_SLOT} from "@chainsafe/lodestar-params";
import {Number64, Slot, Epoch} from "@chainsafe/lodestar-types";
import {computeStartSlotAtEpoch, computeEpochAtSlot} from ".";

export function getSlotsSinceGenesis(config: IBeaconConfig, genesisTime: Number64): Slot {
  const diffInSeconds = Date.now() / 1000 - genesisTime;
  return Math.floor(diffInSeconds / config.SECONDS_PER_SLOT);
}

export function getCurrentSlot(config: IBeaconConfig, genesisTime: Number64): Slot {
  return GENESIS_SLOT + getSlotsSinceGenesis(config, genesisTime);
}

export function computeSlotsSinceEpochStart(slot: Slot, epoch?: Epoch): number {
  const computeEpoch = epoch ? epoch : computeEpochAtSlot(slot);
  return slot - computeStartSlotAtEpoch(computeEpoch);
}

export function computeTimeAtSlot(config: IBeaconConfig, slot: Slot, genesisTime: Number64): Number64 {
  return genesisTime + slot * config.SECONDS_PER_SLOT;
}
