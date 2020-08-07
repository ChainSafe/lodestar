import PeerId from "peer-id";
import {IReputation, IReputationStore} from "../IReputation";
import {Checkpoint, SignedBeaconBlock, Slot, Status, Root, BeaconBlocksByRangeRequest} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IReqResp, INetwork} from "../../network";
import {ISlotRange} from "../interface";
import {IBeaconChain} from "../../chain";
import {getBlockRange, isValidChainOfBlocks, sortBlocks} from "./blocks";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {toHexString} from "@chainsafe/ssz";
import {blockToHeader, computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {sleep} from "../../util/sleep";
import {GENESIS_EPOCH, ZERO_HASH} from "../../constants";

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
    const best =  [...slotStatuses.entries()]
      .sort((a, b) => {
        const aVotes = a[1];
        const bVotes = b[1];
        if(aVotes > bVotes) return -1;
        if(aVotes < bVotes) return 1;
        const aSlot = a[0];
        const bSlot = b[0];
        if(aSlot > bSlot) return -1;
        if(aSlot < bSlot) return 1;
        return 0;
      });
    return best[0][0];
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
        if (voteA.votes > voteB.votes) return -1;
        if (voteA.votes < voteB.votes) return 1;
        if(voteA.checkpoint.epoch > voteB.checkpoint.epoch) return -1;
        if(voteA.checkpoint.epoch < voteB.checkpoint.epoch) return 1;
        return 0;
      }).shift().checkpoint;
  } else {
    return null;
  }
}

export function fetchBlockChunks(
  logger: ILogger,
  chain: IBeaconChain,
  reqResp: IReqResp,
  getPeers: () => Promise<PeerId[]>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  maxBlocksPerChunk?: number
): (source: AsyncIterable<ISlotRange>,) => AsyncGenerator<SignedBeaconBlock[]> {
  return (source) => {
    return (async function*() {
      for await (const slotRange of source) {
        let peers = await getPeers();
        let retry = 0;
        while (peers.length === 0 && retry < 5) {
          logger.info("Waiting for peers...");
          await sleep(6000);
          peers = await getPeers();
          retry++;
        }
        if(peers.length === 0) {
          logger.error("Can't find new peers, stopping sync");
          return;
        }
        try {
          yield await getBlockRange(
            logger,
            reqResp,
            peers,
            slotRange
          );
        } catch (e) {
          logger.debug("Failed to get block range " + JSON.stringify(slotRange) + ". Error: " + e.message);
          return;
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

/**
 * Bufferes and orders block and passes them to chain.
 * Returns last processed slot if it was successful,
 * current head slot if there was consensus split
 * or null if there was no slots
 * @param config
 * @param chain
 * @param logger
 * @param isInitialSync
 * @param trusted
 */
export function processSyncBlocks(
  config: IBeaconConfig, chain: IBeaconChain, logger: ILogger, isInitialSync: boolean, trusted = false
): (source: AsyncIterable<SignedBeaconBlock[]>) => Promise<Slot|null> {
  return async (source) => {
    let blockBuffer: SignedBeaconBlock[] = [];
    let lastProcessedSlot: Slot|null = null;
    for await (const blocks of source) {
      logger.info("Imported blocks for slots: " + blocks.map((block) => block.message.slot).join(","));
      blockBuffer.push(...blocks);
    }
    blockBuffer = sortBlocks(blockBuffer);
    let headRoot = chain.forkChoice.headBlockRoot();
    let headSlot = chain.forkChoice.headBlockSlot();
    while(blockBuffer.length > 0) {
      const signedBlock = blockBuffer.shift();
      const block = signedBlock.message;
      if(!isInitialSync ||
        (isInitialSync && block.slot > headSlot && config.types.Root.equals(headRoot, block.parentRoot))) {
        await chain.receiveBlock(signedBlock, trusted);
        headRoot = config.types.BeaconBlockHeader.hashTreeRoot(blockToHeader(config, block));
        headSlot = block.slot;
        if(block.slot > lastProcessedSlot) {
          lastProcessedSlot = block.slot;
        }
      } else {
        logger.warn(
          "Received block parent root doesn't match our head",
          {
            head: toHexString(headRoot),
            headSlot,
            blockParent: toHexString(block.parentRoot),
            blockSlot: block.slot
          }
        );
        //this will trigger sync to retry to fetch this chunk again
        lastProcessedSlot = lastProcessedSlot || chain.forkChoice.headBlockSlot();
        break;
      }
    }
    return lastProcessedSlot;
  };
}

export function createStatus(chain: IBeaconChain): Status {
  const head = chain.forkChoice.head();
  return {
    forkDigest: chain.currentForkDigest,
    finalizedRoot: head.finalizedCheckpoint.epoch === GENESIS_EPOCH ? ZERO_HASH : head.finalizedCheckpoint.root,
    finalizedEpoch: head.finalizedCheckpoint.epoch,
    headRoot: head.blockRoot,
    headSlot: head.slot,
  };
}

export async function syncPeersStatus(reps: IReputationStore, network: INetwork, status: Status): Promise<void> {
  await Promise.all(network.getPeers().map(async (peerId) => {
    try {
      reps.get(peerId.toB58String()).latestStatus = await network.reqResp.status(peerId, status);
      // eslint-disable-next-line no-empty
    } catch {}
  }));
}

/**
 * Check if a peer supports sync.
 */
export async function checkPeerSupportSync(
  config: IBeaconConfig, reps: IReputationStore, peerId: PeerId, reqResp: IReqResp): Promise<void> {
  const latestStatus = reps.getFromPeerId(peerId).latestStatus;
  if (!latestStatus) {
    reps.getFromPeerId(peerId).supportSync = false;
    return;
  }
  const finalizedSlot = computeStartSlotAtEpoch(config, latestStatus.finalizedEpoch);
  const testCount = 5;
  if (latestStatus.headSlot - finalizedSlot <= testCount) {
    reps.getFromPeerId(peerId).supportSync = false;
    return;
  }
  const testReqResp: BeaconBlocksByRangeRequest = {
    startSlot: finalizedSlot,
    count: testCount,
    step: 1
  };
  const result = await reqResp.beaconBlocksByRange(peerId, testReqResp);
  // a lot of good peers return testCount - 1 = 4 maybe because of missing slot
  // temporarily make it quite relax at least to filter out Nimbus "0 chunks" or "1 chunks" peers
  // or "ERR_UNSUPPORTED_PROTOCOL" peers
  if (result && result.length > 1) {
    reps.getFromPeerId(peerId).supportSync = true;
  } else {
    reps.getFromPeerId(peerId).supportSync = false;
  }
}

export function getBestHead(peers: PeerId[], reps: IReputationStore): {slot: number; root: Root; supportSync: boolean} {
  return peers.map((peerId) => {
    const {latestStatus, supportSync} = reps.get(peerId.toB58String());
    return latestStatus? {slot: latestStatus.headSlot, root: latestStatus.headRoot, supportSync} :
      {slot: 0, root: ZERO_HASH, supportSync};
  }).reduce((head, peerStatus) => {
    return (peerStatus.supportSync && peerStatus.slot >= head.slot) ? peerStatus : head;
  }, {slot: 0, root: ZERO_HASH, supportSync: false});
}

// should add peer score later
export function getBestPeer(config: IBeaconConfig, peers: PeerId[], reps: IReputationStore): PeerId {
  const {root} = getBestHead(peers, reps);
  return peers.find(peerId =>
    config.types.Root.equals(root, reps.get(peerId.toB58String()).latestStatus?.headRoot || ZERO_HASH));
}
