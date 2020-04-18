import {IReputation} from "../IReputation";
import {Checkpoint, SignedBeaconBlock, Slot, Status} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IReqResp} from "../../network";
import {ISlotRange} from "../interface";
import {IBeaconChain} from "../../chain";
import {chunkify, getBlockRange, isValidChainOfBlocks} from "./blocks";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {toHexString} from "@chainsafe/ssz";
import {blockToHeader} from "@chainsafe/lodestar-beacon-state-transition";

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

export function getStatusFinalizedCheckpoint(status: Status): Checkpoint {
  return {epoch: status.finalizedEpoch, root: status.finalizedRoot};
}

export function getCommonFinalizedCheckpoint(config: IBeaconConfig, peers: IReputation[]): Checkpoint|null {
  const checkpointVotes = peers.reduce<Map<string, {checkpoint: Checkpoint; votes: number}>>(
    (current, peer) => {
      if(!peer.latestStatus) {
        return current; 
      }
      const peerCheckpoint = getStatusFinalizedCheckpoint(peer.latestStatus);
      const root = toHexString(config.types.Checkpoint.hashTreeRoot(peerCheckpoint));
      if(current.has(root)) {
        current.get(root).votes++;
      } else {
        current.set(root, {checkpoint: peerCheckpoint, votes: 1});
      }
      return current;
    }, new Map());
  
  if(checkpointVotes.size > 0) {
    return Array.from(checkpointVotes.values())
      .sort((voteA, voteB) => {
        return voteB.votes - voteA.votes;
      }).shift().checkpoint;
  } else {
    return null;
  }
}



export function targetSlotToBlockChunks(
  config: IBeaconConfig, chain: IBeaconChain
): (source: AsyncIterable<Slot>) => AsyncGenerator<ISlotRange> {
  return (source) => {
    return (async function*() {
      for await (const targetSlot of source) {
        yield* chunkify(config.params.SLOTS_PER_EPOCH, (await chain.getHeadState()).slot + 1, targetSlot);
      }
    })();
  };
}



export function fetchBlockChunks(
  chain: IBeaconChain,
  reqResp: IReqResp,
  getPeers: (minSlot: Slot) => Promise<PeerInfo[]>,
  blocksPerChunk = 10
): (source: AsyncIterable<ISlotRange>,) => AsyncGenerator<SignedBeaconBlock[]> {
  return (source) => {
    return (async function*() {
      for await (const blockRange of source) {
        const peers = await getPeers(
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

export function validateBlocks(
  config: IBeaconConfig, chain: IBeaconChain, logger: ILogger, onBlockVerificationFail: Function
): (source: AsyncIterable<SignedBeaconBlock[]>) => AsyncGenerator<SignedBeaconBlock[]> {
  return (source) => {
    return (async function*() {
      for await (const blockChunk of source) {
        if(blockChunk.length === 0) {
          continue;
        }
        const head =  blockToHeader(config, (await chain.getHeadBlock()).message);
        if(
          isValidChainOfBlocks(
            config,
            head,
            blockChunk
          )
        ) {
          yield blockChunk;
        } else {
          logger.warn(
            "Hash chain doesnt match! " 
              + `Head(${head.slot}): ${toHexString(config.types.BeaconBlockHeader.hashTreeRoot(head))}`
              + `Blocks: (${blockChunk[0].message.slot}..${blockChunk[blockChunk.length - 1].message.slot})`
          );
          //discard blocks and trigger resync so we try to fetch blocks again
          onBlockVerificationFail();
        }
      }
    })();
  };
}

export function processBlocks(
  chain: IBeaconChain, logger: ILogger
): (source: AsyncIterable<SignedBeaconBlock[]>) => void {
  return async (source) => {
    for await (const blocks of source) {
      await Promise.all(blocks.map((block) => chain.receiveBlock(block)));
      if(blocks.length > 0) {
        logger.info(`Imported blocks ${blocks[0].message.slot}....${blocks[blocks.length - 1].message.slot}`);
      }
    }
  };
}