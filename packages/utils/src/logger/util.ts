import {EpochSlotOpts} from "./interface";

/**
 * Formats time as: `EPOCH/SLOT_INDEX SECONDS.MILISECONDS
 */
export function formatEpochSlotTime(opts: EpochSlotOpts, now = Date.now()): string {
  const secSinceGenesis = now / 1000 - opts.genesisTime;
  const slot = Math.floor(secSinceGenesis / opts.secondsPerSlot);
  const epoch = Math.floor(slot / opts.slotsPerEpoch);
  const slotIndex = slot % opts.slotsPerEpoch;
  const slotSec = secSinceGenesis % opts.secondsPerSlot;

  return `Eph ${epoch}/${slotIndex} ${slotSec.toFixed(3)}`;
}
