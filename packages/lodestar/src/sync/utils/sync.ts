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

export type Chunk = [Slot, Slot];

/**
 * Creates slot chunks returned chunks represents (inclusive) start and end slot
 * which should be fetched along all slotS(blocks) in between
 * @param blocksPerChunk
 * @param currentSlot
 * @param targetSlot
 */
export function chunkify(blocksPerChunk: number, currentSlot: Slot, targetSlot: Slot): Chunk[] {
  const chunks: Chunk[] = [];
  //currentSlot is our state slot so we need block from next slot
  for(let i = currentSlot + 1; i < targetSlot; i + blocksPerChunk + 1) {
    if(i + blocksPerChunk > targetSlot) {
      chunks.push([i, targetSlot]);
    } else {
      chunks.push([i, i + blocksPerChunk]);
    }
  }
  return chunks;
}