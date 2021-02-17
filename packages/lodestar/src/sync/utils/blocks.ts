import PeerId from "peer-id";
import {BeaconBlocksByRangeRequest, SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";
import {RoundRobinArray} from "./robin";
import {IReqResp} from "../../network";
import {ISlotRange} from "../interface";
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
  // currentSlot is our state slot so we need block from next slot
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
  return await rpc.beaconBlocksByRange(peer, {
    startSlot: chunk.start,
    step: 1,
    count: chunk.end - chunk.start + 1,
  });
}

export async function getBlockRange(
  logger: ILogger,
  rpc: IReqResp,
  peers: PeerId[],
  range: ISlotRange,
  blocksPerChunk?: number,
  maxRetry = 6
): Promise<SignedBeaconBlock[] | null> {
  const totalBlocks = range.end - range.start;
  blocksPerChunk = blocksPerChunk || Math.ceil(totalBlocks / peers.length);
  if (blocksPerChunk < 5) {
    blocksPerChunk = totalBlocks;
  }
  let chunks = chunkify(blocksPerChunk, range.start, range.end);
  let blocks: SignedBeaconBlock[] = [];
  // try to fetch chunks from different peers until all chunks are fetched
  let retry = 0;
  while (chunks.length > 0) {
    // rotate peers
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
            logger.warn("Failed to obtain chunk from peer", {peerId: peer!.toB58String(), ...chunk});
            // if failed to obtain blocks, try in next round on another peer
            return chunk;
          }
        })
      )
    ).filter(notNullish);
    retry++;
    if ((retry > maxRetry || retry > peers.length) && chunks.length > 0) {
      logger.error("Max req retry for blocks by range. Failed chunks", JSON.stringify(chunks));
      return null;
    }
  }
  return sortBlocks(blocks);
}

export function sortBlocks(blocks: SignedBeaconBlock[]): SignedBeaconBlock[] {
  return blocks.sort((b1, b2) => b1.message.slot - b2.message.slot);
}

/**
 * Asserts a response from BeaconBlocksByRange respects the request and is sequential
 * Note: MUST allow missing block for skipped slots.
 */
export function assertSequentialBlocksInRange(blocks: SignedBeaconBlock[], request: BeaconBlocksByRangeRequest): void {
  // Check below would throw for empty ranges
  if (blocks.length === 0) {
    return;
  }

  if (blocks.length > request.count) {
    throw Error(`BlockRangeError: wrong length ${blocks.length} > ${request.count}`);
  }

  const minSlot = request.startSlot;
  const maxSlot = request.startSlot + request.count * request.step;
  const firstSlot = blocks[0].message.slot;
  const lastSlot = blocks[blocks.length - 1].message.slot;

  if (firstSlot < minSlot) {
    throw Error(`BlockRangeError: wrong firstSlot ${firstSlot} < ${minSlot}`);
  }

  if (lastSlot > maxSlot) {
    throw Error(`BlockRangeError: wrong lastSlot ${lastSlot} > ${maxSlot}`);
  }

  // Assert sequential with request.step
  for (let i = 0; i < blocks.length - 1; i++) {
    const slotL = blocks[i].message.slot;
    const slotR = blocks[i + 1].message.slot;
    if (slotL + request.step > slotR) {
      throw Error(`BlockRangeError: wrong sequence ${slotL} + ${request.step} > ${slotR}`);
    }
  }
}
