import {IReputation, ReputationStore} from "../IReputation";
import {BeaconBlock, BeaconBlockHeader, Checkpoint, Epoch, Hash, Slot} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {hashTreeRoot} from "@chainsafe/ssz";
import {blockToHeader} from "../../chain/stateTransition/util";
import {IReqResp} from "../../network";

export function isValidHeaderChain(config: IBeaconConfig, start: BeaconBlockHeader, blocks: BeaconBlock[]): boolean {
  let previousRoot = hashTreeRoot(start, config.types.BeaconBlockHeader);
  for(const block of blocks) {
    if(!previousRoot.equals(block.parentRoot)) {
      return false;
    }
    previousRoot = hashTreeRoot(blockToHeader(config, block), config.types.BeaconBlockHeader);
  }
  return true;
}

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

export interface ISlotRange {
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
export function chunkify(blocksPerChunk: number, currentSlot: Slot, targetSlot: Slot): ISlotRange[] {
  const chunks: ISlotRange[] = [];
  //currentSlot is our state slot so we need block from next slot
  for(let i = currentSlot + 1; i < targetSlot; i  = i + blocksPerChunk) {
    if(i + blocksPerChunk > targetSlot) {
      chunks.push({
        start: i,
        end: targetSlot
      });
    } else {
      chunks.push({
        start: i,
        end: i + blocksPerChunk - 1
      });
    }
  }
  return chunks;
}


export async function getBlockRangeFromPeer(
  rpc: IReqResp,
  reps: ReputationStore,
  peer: PeerInfo,
  chunk: ISlotRange
): Promise<BeaconBlock[]> {
  const peerLatestHello = reps.get(peer.id.toB58String()).latestHello;
  return await rpc.beaconBlocksByRange(
    peer,
    {
      headBlockRoot: peerLatestHello.headRoot,
      startSlot: chunk.start,
      step: 1,
      count: chunk.end - chunk.start
    }
  );
}