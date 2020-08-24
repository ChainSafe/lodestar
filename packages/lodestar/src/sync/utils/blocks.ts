import PeerId from "peer-id";
import {BeaconBlockHeader, SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";
import {RoundRobinArray} from "./robin";
import {IReqResp} from "../../network";
import {ISlotRange} from "../interface";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {notNullish} from "../../util/notNullish";

/**
 * Creates slot chunks returned chunks represents (inclusive) start and (inclusive) end slot
 * which should be fetched along all slotS(blocks) in between
 * @param blocksPerChunk
 * @param currentSlot
 * @param targetSlot
 */
export function chunkify(blocksPerChunk: number, currentSlot: Slot, targetSlot: Slot): ISlotRange[] {
  if (blocksPerChunk < 5) {
    blocksPerChunk = 5;
  }
  const chunks: ISlotRange[] = [];
  //currentSlot is our state slot so we need block from next slot
  for (let i = currentSlot; i <= targetSlot; i = i + blocksPerChunk + 1) {
    chunks.push({
      start: i,
      end: Math.min(i + blocksPerChunk, targetSlot),
    });
  }
  return chunks;
}

export async function getBlockRangeFromPeer(
  rpc: IReqResp,
  peer: PeerId,
  chunk: ISlotRange
): Promise<SignedBeaconBlock[] | null> {
  return (await rpc.beaconBlocksByRange(peer, {
    startSlot: chunk.start,
    step: 1,
    count: chunk.end - chunk.start + 1,
  })) as SignedBeaconBlock[];
}

export async function getBlockRange(
  logger: ILogger,
  rpc: IReqResp,
  peers: PeerId[],
  range: ISlotRange,
  blocksPerChunk?: number,
  maxRetry = 6
): Promise<SignedBeaconBlock[]> {
  const totalBlocks = range.end - range.start;
  blocksPerChunk = blocksPerChunk || Math.ceil(totalBlocks / peers.length);
  if (blocksPerChunk < 5) {
    blocksPerChunk = totalBlocks;
  }
  let chunks = chunkify(blocksPerChunk, range.start, range.end);
  let blocks: SignedBeaconBlock[] = [];
  //try to fetch chunks from different peers until all chunks are fetched
  let retry = 0;
  while (chunks.length > 0) {
    //rotate peers
    const peerBalancer = new RoundRobinArray(peers);
    chunks = (
      await Promise.all(
        chunks.map(async (chunk) => {
          const peer = peerBalancer.next();
          let chunkBlocks;
          try {
            chunkBlocks = await getBlockRangeFromPeer(rpc, peer!, chunk);
          } catch (e) {
            chunkBlocks = null;
          }
          if (chunkBlocks) {
            blocks = blocks.concat(chunkBlocks);
            return null;
          } else {
            logger.warn(`Failed to obtain chunk ${JSON.stringify(chunk)} ` + `from peer ${peer!.toB58String()}`);
            //if failed to obtain blocks, try in next round on another peer
            return chunk;
          }
        })
      )
    ).filter(notNullish);
    retry++;
    if (retry > maxRetry || retry > peers.length) {
      logger.error("Max req retry for blocks by range. Failed chunks: " + JSON.stringify(chunks));
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
  signedBlocks: SignedBeaconBlock[]
): boolean {
  let parentRoot = config.types.BeaconBlockHeader.hashTreeRoot(start);
  for (const signedBlock of signedBlocks) {
    if (!config.types.Root.equals(parentRoot, signedBlock.message.parentRoot)) {
      return false;
    }
    parentRoot = config.types.BeaconBlock.hashTreeRoot(signedBlock.message);
  }
  return true;
}
