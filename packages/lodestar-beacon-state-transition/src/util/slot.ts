import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Epoch, Number64, Slot} from "@chainsafe/lodestar-types";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from ".";
import {GENESIS_SLOT} from "../constants";

export function getSlotsSinceGenesis(config: IBeaconConfig, genesisTime: Number64): Slot {
  const diffInMiliSeconds = Date.now() - genesisTime * 1000;
  return Math.round(diffInMiliSeconds / (config.params.SECONDS_PER_SLOT * 1000));
}

export function getCurrentSlot(config: IBeaconConfig, genesisTime: Number64): Slot {
  return GENESIS_SLOT + getSlotsSinceGenesis(config, genesisTime);
}

export function computeSlotsSinceEpochStart(config: IBeaconConfig, slot: Slot, epoch?: Epoch): number {
  const computeEpoch = epoch ? epoch : computeEpochAtSlot(config, slot);
  return slot - computeStartSlotAtEpoch(config, computeEpoch);
}

export function computeTimeAtSlot(config: IBeaconConfig, slot: Slot, genesisTime: Number64): Number64 {
  return genesisTime + slot * config.params.SECONDS_PER_SLOT;
}
