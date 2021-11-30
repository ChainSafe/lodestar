import {IChainConfig} from "@chainsafe/lodestar-config";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {Slot} from "@chainsafe/lodestar-types";

export function getCurrentSlot(config: IChainConfig, genesisTime: number): Slot {
  const diffInSeconds = Date.now() / 1000 - genesisTime;
  return Math.floor(diffInSeconds / config.SECONDS_PER_SLOT);
}

/** Returns the slot if the internal clock were advanced by `toleranceSec`. */
export function slotWithFutureTolerance(config: IChainConfig, genesisTime: number, toleranceSec: number): Slot {
  // this is the same to getting slot at now + toleranceSec
  return getCurrentSlot(config, genesisTime - toleranceSec);
}

export function timeUntilNextEpoch(config: Pick<IChainConfig, "SECONDS_PER_SLOT">, genesisTime: number): number {
  const miliSecondsPerEpoch = SLOTS_PER_EPOCH * config.SECONDS_PER_SLOT * 1000;
  const msFromGenesis = Date.now() - genesisTime * 1000;
  if (msFromGenesis >= 0) {
    return miliSecondsPerEpoch - (msFromGenesis % miliSecondsPerEpoch);
  } else {
    return Math.abs(msFromGenesis % miliSecondsPerEpoch);
  }
}
