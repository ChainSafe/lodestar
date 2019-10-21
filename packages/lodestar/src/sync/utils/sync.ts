import {IReputation} from "../IReputation";
import {Checkpoint, Epoch, Slot} from "@chainsafe/eth2.0-types";

export function getTargetEpoch(peers: IReputation[], currentCheckPoint: Checkpoint): Epoch {
  const peersWithHigherFinalizedEpoch = peers.filter(peer => {
    if(!peer.latestHello) {
      return false;
    }
    if(peer.latestHello.finalizedEpoch > currentCheckPoint.epoch) {
      return true;
    }
  });
  if(peersWithHigherFinalizedEpoch.length > 0) {
    return currentCheckPoint.epoch + 1;
  }
  return currentCheckPoint.epoch;
}

export interface IChunk {
  start: Slot;
  end: Slot;
}

/**
 * Creates slot chunks returned chunks represents (inclusive) start and (inclusive) end slot
 * which should be fetched along all slotS(blocks) in between
 * @param blocksPerChunk
 * @param currentSlot
 * @param targetSlot
 */
export function chunkify(blocksPerChunk: number, currentSlot: Slot, targetSlot: Slot): IChunk[] {
  const chunks: IChunk[] = [];
  //currentSlot is our state slot so we need block from next slot
  for(let i = currentSlot + 1; i < targetSlot; i + blocksPerChunk + 1) {
    if(i + blocksPerChunk > targetSlot) {
      chunks.push({
        start: i,
        end: targetSlot
      });
    } else {
      chunks.push({
        start: i,
        end: i + blocksPerChunk
      });
    }
  }
  return chunks;
}