import {BeaconBlockHeader, SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";
import {RoundRobinArray} from "./robin";
import {IReqResp} from "../../network";
import {ZERO_HASH} from "../../constants";
import {ISlotRange} from "../interface";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

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
  peer: PeerInfo,
  chunk: ISlotRange
): Promise<SignedBeaconBlock[]> {
  return await rpc.beaconBlocksByRange(
    peer,
    {
      headBlockRoot: ZERO_HASH,
      startSlot: chunk.start,
      step: 1,
      count: chunk.end - chunk.start
    }
  ) as SignedBeaconBlock[];
}

export async function getBlockRange(
  rpc: IReqResp,
  peers: PeerInfo[],
  range: ISlotRange,
  blocksPerChunk = 10,
  maxRetry = 3
): Promise<SignedBeaconBlock[]> {
  let chunks = chunkify(blocksPerChunk, range.start, range.end);
  let blocks: SignedBeaconBlock[] = [];
  //try to fetch chunks from different peers until all chunks are fetched
  let retry = 0;
  while(chunks.length > 0) {
    //rotate peers
    const peerBalancer = new RoundRobinArray(peers);
    chunks = (await Promise.all(
      chunks.map(async (chunk) => {
        try {
          const chunkBlocks = await getBlockRangeFromPeer(rpc, peerBalancer.next(), chunk);
          blocks = blocks.concat(chunkBlocks);
          return null;
        } catch (e) {
          console.log(e);
          //if failed to obtain blocks, try in next round on another peer
          return chunk;
        }
      })
    )).filter((chunk) => chunk !== null);
    retry++;
    if(retry > maxRetry) {
      throw new Error("Max req retry for blocks by range");
    }
  }
  return sortBlocks(blocks);
}

export function sortBlocks(blocks: SignedBeaconBlock[]): SignedBeaconBlock[] {
  return blocks.sort((b1, b2) => b1.message.slot - b2.message.slot);
}


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