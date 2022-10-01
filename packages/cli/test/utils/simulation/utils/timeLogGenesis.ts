import {IChainConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH} from "@lodestar/params";

/**
 * Formats time as: `EPOCH/SLOT_INDEX SECONDS.MILISECONDS
 */
export function formatEpochSlotTime(genesisTime: number, config: IChainConfig): string {
  const nowSec = Date.now() / 1000;
  const secSinceGenesis = nowSec - genesisTime;
  const epoch = Math.floor(secSinceGenesis / (SLOTS_PER_EPOCH * config.SECONDS_PER_SLOT));
  const epochStartSec = genesisTime + epoch * SLOTS_PER_EPOCH * config.SECONDS_PER_SLOT;
  const secSinceStartEpoch = nowSec - epochStartSec;
  const slotIndex = Math.floor(secSinceStartEpoch / config.SECONDS_PER_SLOT);
  const slotSec = secSinceStartEpoch % config.SECONDS_PER_SLOT;
  return `${epoch}/${slotIndex} ${slotSec.toFixed(3)}`;
}
