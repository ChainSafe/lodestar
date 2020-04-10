import {SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {chunkify, getBlockRangeFromPeer, ISlotRange} from "./sync";
import {RoundRobinArray} from "./robin";
import {IReqResp} from "../../network";

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
