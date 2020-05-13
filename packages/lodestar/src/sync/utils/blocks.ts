import {BeaconBlockHeader, SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";
import {RoundRobinArray} from "./robin";
import {IReqResp} from "../../network";
import {ISlotRange} from "../interface";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";

/**
 * Creates slot chunks returned chunks represents (inclusive) start and (inclusive) end slot
 * which should be fetched along all slotS(blocks) in between
 * @param blocksPerChunk
 * @param currentSlot
 * @param targetSlot
 */
export function chunkify(blocksPerChunk: number, currentSlot: Slot, targetSlot: Slot): ISlotRange[] {
  if(blocksPerChunk < 5) {
    blocksPerChunk = 5;
  }
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
      startSlot: chunk.start,
      step: 1,
      count: chunk.end - chunk.start
    }
  ) as SignedBeaconBlock[];
}

export async function getBlockRange(
  logger: ILogger,
  rpc: IReqResp,
  peers: PeerInfo[],
  range: ISlotRange,
  blocksPerChunk?: number,
  maxRetry = 6
): Promise<SignedBeaconBlock[]> {
  blocksPerChunk = blocksPerChunk || range.end - range.start;
  let chunks = chunkify(blocksPerChunk, range.start, range.end);
  let blocks: SignedBeaconBlock[] = [];
  //try to fetch chunks from different peers until all chunks are fetched
  let retry = 0;
  while(chunks.length > 0) {
    //rotate peers
    const peerBalancer = new RoundRobinArray(peers);
    chunks = (await Promise.all(
      chunks.map(async (chunk) => {
        const peer = peerBalancer.next();
        try {
          const chunkBlocks = await getBlockRangeFromPeer(rpc, peer, chunk);
          if(chunkBlocks.length === 0) {
            throw "received 0 blocks, try another peer";
          }
          blocks = blocks.concat(chunkBlocks);
          return null;
        } catch (e) {
          logger.debug(`Failed to obtain chunk ${JSON.stringify(chunk)} `
              +`from peer ${peer.id.toB58String()}. Error: ${e.message}`
          );
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
