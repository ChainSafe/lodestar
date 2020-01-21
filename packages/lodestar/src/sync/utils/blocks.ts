import {BeaconBlock, SignedBeaconBlock} from "@chainsafe/eth2.0-types";
import {chunkify, getBlockRangeFromPeer, ISlotRange} from "./sync";
import {RoundRobinArray} from "./robin";
import {IReqResp} from "../../network";
import {ReputationStore} from "../IReputation";

export async function getBlockRange(
  rpc: IReqResp,
  reps: ReputationStore,
  peers: PeerInfo[],
  range: ISlotRange,
  blocksPerChunk = 10
): Promise<SignedBeaconBlock[]> {
  let chunks = chunkify(blocksPerChunk, range.start, range.end);
  let blocks: SignedBeaconBlock[] = [];
  //try to fetch chunks from different peers until all chunks are fetched
  while(chunks.length > 0) {
    //rotate peers
    const peerBalancer = new RoundRobinArray(peers);
    chunks = (await Promise.all(
      chunks.map(async (chunk) => {
        try {
          const chunkBlocks = await getBlockRangeFromPeer(rpc, reps, peerBalancer.next(), chunk);
          blocks = blocks.concat(chunkBlocks);
          return null;
        } catch (e) {
          //if failed to obtain blocks, try in next round on another peer
          return chunk;
        }
      })
    )).filter((chunk) => chunk !== null);
  }
  return sortBlocks(blocks);
}

export function sortBlocks(blocks: SignedBeaconBlock[]): SignedBeaconBlock[] {
  return blocks.sort((b1, b2) => b1.message.slot - b2.message.slot);
}
