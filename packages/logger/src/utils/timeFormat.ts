import {EpochSlotOpts} from "../interface.js";

/**
 * Formats time as: `EPOCH/SLOT_INDEX SECONDS.MILLISECONDS
 */
export function formatEpochSlotTime(opts: EpochSlotOpts, now = Date.now()): string {
  const nowSec = now / 1000;
  let eraStartSlot = 0;
  let eraStartSec = opts.genesisTime;
  let secondsPerSlot = opts.secondsPerSlot;
  for (const [forkEpoch, forkSecondsPerSlot] of opts.slotDurations ?? []) {
    const forkSlot = forkEpoch * opts.slotsPerEpoch;
    const forkSec = eraStartSec + (forkSlot - eraStartSlot) * secondsPerSlot;
    if (nowSec < forkSec) break;
    eraStartSlot = forkSlot;
    eraStartSec = forkSec;
    secondsPerSlot = forkSecondsPerSlot;
  }
  const slot = eraStartSlot + Math.floor((nowSec - eraStartSec) / secondsPerSlot);
  const epoch = Math.floor(slot / opts.slotsPerEpoch);
  const slotIndex = slot - epoch * opts.slotsPerEpoch;
  const slotSec = nowSec - (eraStartSec + (slot - eraStartSlot) * secondsPerSlot);
  return `Eph ${epoch}/${slotIndex} ${slotSec.toFixed(3)}`;
}
