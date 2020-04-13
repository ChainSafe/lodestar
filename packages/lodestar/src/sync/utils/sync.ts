import {IReputation, ReputationStore} from "../IReputation";
import {BeaconBlockHeader, Checkpoint, Epoch, Slot, SignedBeaconBlock, Status,
  BeaconState} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IReqResp} from "../../network";

export function isValidChainOfBlocks(
  config: IBeaconConfig,
  start: BeaconBlockHeader,
  signedBlocks: SignedBeaconBlock[],
): boolean {
  let parentRoot = config.types.BeaconBlockHeader.hashTreeRoot(start);
  for(const signedBlock of signedBlocks) {
    if(!config.types.Root.equals(parentRoot, signedBlock.message.parentRoot)) {
      return false;
    }
    parentRoot = config.types.BeaconBlock.hashTreeRoot(signedBlock.message);
  }
  return true;
}

export function getInitalSyncTargetEpoch(peers: IReputation[], currentCheckPoint: Checkpoint): Epoch {
  const numberOfEpochToBatch = 1;
  const peersWithHigherFinalizedEpoch = peers.filter(peer => {
    if(!peer.latestStatus) {
      return false;
    }
    if(peer.latestStatus.finalizedEpoch > currentCheckPoint.epoch) {
      return true;
    }
  });
  if(peersWithHigherFinalizedEpoch.length > 0) {
    return currentCheckPoint.epoch + numberOfEpochToBatch;
  }
  return currentCheckPoint.epoch;
}

export function getHighestCommonSlot(peers: IReputation[]): Slot {
  const slotStatuses = peers.reduce<Map<Slot, number>>((current, peer) => {
    if(peer.latestStatus && current.has(peer.latestStatus.headSlot)) {
      current.set(peer.latestStatus.headSlot + 1, current.get(peer.latestStatus.headSlot) + 1);
    } else if(peer.latestStatus) {
      current.set(peer.latestStatus.headSlot + 1, 1);
    }
    return current;
  }, new Map<Slot, number>());
  if(slotStatuses.size) {
    return [...slotStatuses.entries()].sort((a, b) => {
      return a[1] - b[1];
    })[0][0];
  } else {
    return 0;
  }
}

export function isSynced(slot: Slot, peers: IReputation[]): boolean {
  return slot >= getHighestCommonSlot(peers);
}

export function isValidFinalizedCheckPoint(peers: IReputation[], finalizedCheckpoint: Checkpoint): boolean {
  const validPeers = peers.filter((peer) => !!peer.latestStatus);
  const finalizedRoot = Buffer.from(finalizedCheckpoint.root as Uint8Array);
  const peerCount = validPeers.filter(peer => {
    return Buffer.from(peer.latestStatus.finalizedRoot as Uint8Array).equals(finalizedRoot);
  }).length;
  return peerCount >= (validPeers.length / 2);
}

export function isValidPeerForInitSync(config: IBeaconConfig, myState: BeaconState|null, peerStatus: Status): boolean {
  if (!peerStatus) {
    return false;
  }
  // TODO: compare fork_digest in the latest spec?
  return !(myState && peerStatus.finalizedEpoch < myState.finalizedCheckpoint.epoch);

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
  for(let i = currentSlot; i < targetSlot; i  = i + blocksPerChunk) {
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
): Promise<SignedBeaconBlock[]> {
  const peerLatestHello = reps.get(peer.id.toB58String()).latestStatus;
  return await rpc.beaconBlocksByRange(
    peer,
    {
      headBlockRoot: peerLatestHello.headRoot,
      startSlot: chunk.start,
      step: 1,
      count: chunk.end - chunk.start
    }
  ) as SignedBeaconBlock[];
}
