import {IReputation} from "../IReputation";
import {Checkpoint, SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IReqResp} from "../../network";
import {ISlotRange} from "../interface";
import {IBeaconChain} from "../../chain";
import {chunkify, getBlockRange} from "./blocks";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";

export function getHighestCommonSlot(peers: IReputation[]): Slot {
  const slotStatuses = peers.reduce<Map<Slot, number>>((current, peer) => {
    if(peer.latestStatus && current.has(peer.latestStatus.headSlot)) {
      current.set(peer.latestStatus.headSlot, current.get(peer.latestStatus.headSlot) + 1);
    } else if(peer.latestStatus) {
      current.set(peer.latestStatus.headSlot, 1);
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



export function targetSlotToBlockChunks(
  config: IBeaconConfig, chain: IBeaconChain
): (source: AsyncIterable<Slot>) => AsyncGenerator<ISlotRange> {
  return (source) => {
    return (async function*() {
      for await (const targetSlot of source) {
        yield* chunkify(config.params.SLOTS_PER_EPOCH, (await chain.getHeadState()).slot, targetSlot);
      }
    })();
  };
}



export function fetchBlockChunks(
  chain: IBeaconChain,
  reqResp: IReqResp,
  getPeers: (c: Checkpoint, minSlot: Slot) => PeerInfo[],
  blocksPerChunk = 10
): (source: AsyncIterable<ISlotRange>,) => AsyncGenerator<SignedBeaconBlock[]> {
  return (source) => {
    return (async function*() {
      for await (const blockRange of source) {
        const peers = getPeers(
          (await chain.getHeadState()).finalizedCheckpoint,
          blockRange.end
        );
        if(peers.length > 0) {
          yield await getBlockRange(
            reqResp,
            peers,
            blockRange,
            blocksPerChunk
          );
        }
      }
    })();
  };
}

export function processBlocks(
  chain: IBeaconChain, logger: ILogger
): (source: AsyncIterable<SignedBeaconBlock[]>) => void {
  return (source => {
    (async function() {
      for await (const blocks of source) {
        await Promise.all(blocks.map((block) => chain.receiveBlock(block)));
        if(blocks.length > 0) {
          logger.info(`Imported blocks ${blocks[0].message.slot}....${blocks[blocks.length - 1].message.slot}`);
        }
      }
    })();
  });
}