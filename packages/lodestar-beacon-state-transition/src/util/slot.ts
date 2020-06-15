import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Number64, Slot, Epoch,} from "@chainsafe/lodestar-types";
import {intDiv} from "@chainsafe/lodestar-utils";
import {computeStartSlotAtEpoch, computeEpochAtSlot} from ".";
import {GENESIS_SLOT} from "../constants";

export function getSlotsSinceGenesis(config: IBeaconConfig, genesisTime: Number64): Slot {
  const diffInSeconds = (Date.now() / 1000) - genesisTime;
  return BigInt(intDiv(diffInSeconds, config.params.SECONDS_PER_SLOT));
}

export function getCurrentSlot(config: IBeaconConfig, genesisTime: Number64): Slot {
  return GENESIS_SLOT + getSlotsSinceGenesis(config, genesisTime);
}

export function computeSlotsSinceEpochStart(config: IBeaconConfig, slot: Slot, epoch?: Epoch): number {
  const computeEpoch = epoch ? epoch : computeEpochAtSlot(config, slot);
  return Number(slot - computeStartSlotAtEpoch(config, computeEpoch));
}

export function computeTimeAtSlot(config: IBeaconConfig, slot: Slot, genesisTime: Number64): Number64 {
  return genesisTime + Number(slot) * config.params.SECONDS_PER_SLOT;
}