import PeerId from "peer-id";
import {BeaconBlockHeader, SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";
import {RoundRobinArray} from "./robin";
import {IReqResp} from "../../network";
import {ISlotRange} from "../interface";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {sleep} from "../../util/sleep";

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
  for(let i = currentSlot; i < targetSlot; i  = i + blocksPerChunk + 1) {
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

export async function getBlockRangeFromPeer(
  rpc: IReqResp,
  peer: PeerId,
  chunk: ISlotRange,
  step = 1
): Promise<SignedBeaconBlock[]|null> {
  return await rpc.beaconBlocksByRange(
    peer,
    {
      startSlot: chunk.start,
      step,
      count: Math.floor((chunk.end - chunk.start) / step) + 1
    }
  ) as SignedBeaconBlock[];
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
  blocksPerChunk = blocksPerChunk || Math.ceil(totalBlocks/peers.length);
  if(blocksPerChunk < 5) {
    blocksPerChunk = totalBlocks;
  }
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
        const chunkBlocks = await getBlockRangeFromPeer(rpc, peer, chunk);
        if(chunkBlocks) {
          blocks = blocks.concat(chunkBlocks);
          return null;
        } else {
          logger.warn(`Failed to obtain chunk ${JSON.stringify(chunk)} `
            +`from peer ${peer.toB58String()}`);
          await sleep(1000);
          //if failed to obtain blocks, try in next round on another peer
          return chunk;
        }
      })
    )).filter((chunk) => chunk !== null);
    retry++;
    if(retry > maxRetry || retry > peers.length) {
      logger.error("Max req retry for blocks by range. Failed chunks: " + JSON.stringify(chunks));
    }
  }
  return sortBlocks(blocks);
}

export async function getBlockRangeInterleave(
  logger: ILogger, rpc: IReqResp, peers: PeerId[], range: ISlotRange,
): Promise<SignedBeaconBlock[]> {
  // TODO: order peers by peer score?
  const totalBlocks = range.end - range.start + 1;
  const minBlockPerRequest = 3;
  const numPeer = Math.min(peers.length, Math.floor(totalBlocks / minBlockPerRequest));
  const peerBalancer = new RoundRobinArray(peers);
  // Round 0
  const round0Promises = [];
  const selectedPeers = [];
  const interleaveRanges: ISlotRange[] = [];
  for (let i = 0; i < numPeer; i++) {
    const peer = peerBalancer.next();
    const interleaveRange = {start: range.start + i, end: range.end};
    // step = numPeer
    round0Promises.push(getBlockRangeFromPeer(rpc, peer, interleaveRange, numPeer));
    selectedPeers.push(peer);
    interleaveRanges.push(interleaveRange);
  }
  const round0BlocksByRequest = await Promise.all(round0Promises);
  const retryRanges: ISlotRange[] = [];
  round0BlocksByRequest.forEach((blocks, index) => {
    const oldRange = interleaveRanges[index];
    if (shouldRetryRange(oldRange, blocks, numPeer)) {
      const range = {
        start: (!blocks || blocks.length === 0)?
          oldRange.start : Math.max(...blocks.map(block => block.message.slot)) + numPeer,
        end: oldRange.end};
      retryRanges.push(range);
      logger.verbose(`Retry range ${JSON.stringify(oldRange)} by ${JSON.stringify(range)} ` +
        `num block=${blocks && blocks.length}, num peer(step)=${numPeer}`);
    }
  });
  const round0Blocks = toBlocks(round0BlocksByRequest);
  if (retryRanges.length === 0 || selectedPeers.length === 1) return sortBlocks(round0Blocks);
  if (round0Blocks.length === 0) {
    // next call will shuffle peers hopefully
    logger.warn(`All beacon_block_by_range requests return null or no block for range ${JSON.stringify(range)}`);
    return [];
  }
  // Round 1: fallback
  const lastSlot = Math.max(...round0Blocks.map(block => block.message.slot));
  const bestPeerIndex = round0BlocksByRequest.findIndex(
    (value) => value && value.length > 0 && value[value.length - 1].message.slot === lastSlot);
  const bestPeer = selectedPeers[bestPeerIndex];
  const round1BlocksByRequest =
    await Promise.all(retryRanges.map((range) => getBlockRangeFromPeer(rpc, bestPeer, range, numPeer)));
  const round1Blocks = toBlocks(round1BlocksByRequest);
  return sortBlocks([...round0Blocks, ...round1Blocks]);
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

export function shouldRetryRange(range: ISlotRange, blocks: SignedBeaconBlock[], step: number): boolean {
  let slot = range.start;
  while (slot + step < range.end) {
    slot += step;
  }
  if (!blocks || blocks.length === 0 ||
    Math.max(...blocks.map(block => block.message.slot)) < slot) {
    return true;
  }
  return false;
}

export function toBlocks(blocksByRequest: SignedBeaconBlock[][]): SignedBeaconBlock[] {
  return blocksByRequest.reduce((allBlocks, blocks) => {
    return allBlocks.concat(blocks? blocks : []);
  }, []);
}