import PeerId from "peer-id";
import {IReputation, IReputationStore} from "../IReputation";
import {Checkpoint, SignedBeaconBlock, Slot, Status, Root, BeaconBlocksByRangeRequest} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IReqResp, INetwork} from "../../network";
import {ISlotRange} from "../interface";
import {IBeaconChain, ILMDGHOST} from "../../chain";
import {getBlockRange, isValidChainOfBlocks, sortBlocks} from "./blocks";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {toHexString, List} from "@chainsafe/ssz";
import {blockToHeader} from "@chainsafe/lodestar-beacon-state-transition";
import {sleep} from "../../util/sleep";
import {GENESIS_EPOCH, ZERO_HASH, Method} from "../../constants";

export function getHighestCommonSlot(peers: IReputation[]): Slot {
  const slotStatuses = peers.reduce<Map<Slot, number>>((current, peer) => {
    if (peer.latestStatus && current.has(peer.latestStatus.headSlot)) {
      current.set(peer.latestStatus.headSlot, current.get(peer.latestStatus.headSlot)! + 1);
    } else if (peer.latestStatus) {
      current.set(peer.latestStatus.headSlot, 1);
    }
    return current;
  }, new Map<Slot, number>());
  if (slotStatuses.size) {
    const best = [...slotStatuses.entries()].sort((a, b) => {
      const aVotes = a[1];
      const bVotes = b[1];
      if (aVotes > bVotes) return -1;
      if (aVotes < bVotes) return 1;
      const aSlot = a[0];
      const bSlot = b[0];
      if (aSlot > bSlot) return -1;
      if (aSlot < bSlot) return 1;
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

export function getCommonFinalizedCheckpoint(config: IBeaconConfig, peers: IReputation[]): Checkpoint | null {
  const checkpointVotes = peers.reduce<Map<string, {checkpoint: Checkpoint; votes: number}>>((current, peer) => {
    if (!peer.latestStatus) {
      return current;
    }
    const peerCheckpoint = getStatusFinalizedCheckpoint(peer.latestStatus);
    const root = toHexString(config.types.Checkpoint.hashTreeRoot(peerCheckpoint));
    if (current.has(root)) {
      current.get(root)!.votes++;
    } else {
      current.set(root, {checkpoint: peerCheckpoint, votes: 1});
    }
    return current;
  }, new Map());
  if (checkpointVotes.size > 0) {
    return Array.from(checkpointVotes.values())
      .sort((voteA, voteB) => {
        if (voteA.votes > voteB.votes) return -1;
        if (voteA.votes < voteB.votes) return 1;
        if (voteA.checkpoint.epoch > voteB.checkpoint.epoch) return -1;
        if (voteA.checkpoint.epoch < voteB.checkpoint.epoch) return 1;
        return 0;
      })
      .shift()!.checkpoint;
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
): (source: AsyncIterable<ISlotRange>) => AsyncGenerator<SignedBeaconBlock[] | null> {
  return (source) => {
    return (async function* () {
      for await (const slotRange of source) {
        let peers = await getPeers();
        let retry = 0;
        while (peers.length === 0 && retry < 5) {
          logger.info("Waiting for peers...");
          await sleep(6000);
          peers = await getPeers();
          retry++;
        }
        if (peers.length === 0) {
          logger.error("Can't find new peers");
          yield null;
          return;
        }
        try {
          yield await getBlockRange(logger, reqResp, peers, slotRange);
        } catch (e) {
          logger.debug("Failed to get block range " + JSON.stringify(slotRange) + ". Error: " + e.message);
          yield null;
          return;
        }
      }
    })();
  };
}

export function validateBlocks(
  config: IBeaconConfig,
  chain: IBeaconChain,
  logger: ILogger,
  onBlockVerificationFail: Function
): (source: AsyncIterable<SignedBeaconBlock[]>) => AsyncGenerator<SignedBeaconBlock[]> {
  return (source) => {
    return (async function* () {
      for await (const blockChunk of source) {
        if (blockChunk.length === 0) {
          continue;
        }
        const head = blockToHeader(config, (await chain.getHeadBlock())!.message);
        if (isValidChainOfBlocks(config, head, blockChunk)) {
          yield blockChunk;
        } else {
          logger.warn(
            "Hash chain doesnt match! " +
              `Head(${head.slot}): ${toHexString(config.types.BeaconBlockHeader.hashTreeRoot(head))}` +
              `Blocks: (${blockChunk[0].message.slot}..${blockChunk[blockChunk.length - 1].message.slot})`
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
 * current head slot if there was consensus split,
 * previous head slot if it failed to fetch range,
 * or null if there was no slots
 * @param config
 * @param chain
 * @param logger
 * @param isInitialSync
 * @param lastProcessedBlock only needed for initial sync
 * @param trusted
 */
export function processSyncBlocks(
  config: IBeaconConfig,
  chain: IBeaconChain,
  logger: ILogger,
  isInitialSync: boolean,
  lastProcessedBlock: SignedBeaconBlock | null,
  trusted = false
): (source: AsyncIterable<SignedBeaconBlock[] | null>) => Promise<Slot | null> {
  return async (source) => {
    let blockBuffer: SignedBeaconBlock[] = [];
    let lastProcessedSlot: Slot | null = null;
    let headRoot = isInitialSync ? config.types.BeaconBlock.hashTreeRoot(lastProcessedBlock!.message) : null;
    let headSlot = isInitialSync ? lastProcessedBlock!.message.slot : chain.forkChoice.headBlockSlot();
    for await (const blocks of source) {
      if (!blocks) {
        // failed to fetch range, trigger sync to retry
        logger.warn("Failed to get blocks for range", {
          headSlot,
        });
        return headSlot;
      }
      logger.info("Imported blocks for slots: " + blocks.map((block) => block.message.slot).join(","));
      blockBuffer.push(...blocks);
    }
    blockBuffer = sortBlocks(blockBuffer);
    while (blockBuffer.length > 0) {
      const signedBlock = blockBuffer.shift()!;
      const block = signedBlock.message;
      if (
        !isInitialSync ||
        (isInitialSync && block.slot > headSlot! && config.types.Root.equals(headRoot!, block.parentRoot))
      ) {
        await chain.receiveBlock(signedBlock, trusted);
        headRoot = config.types.BeaconBlockHeader.hashTreeRoot(blockToHeader(config, block));
        headSlot = block.slot;
        if (block.slot > lastProcessedSlot!) {
          lastProcessedSlot = block.slot;
        }
      } else {
        logger.warn("Received block parent root doesn't match our head", {
          head: toHexString(headRoot!),
          headSlot,
          blockParent: toHexString(block.parentRoot),
          blockSlot: block.slot,
        });
        //this will trigger sync to retry to fetch this chunk again
        lastProcessedSlot = lastProcessedSlot || headSlot;
        break;
      }
    }
    return lastProcessedSlot;
  };
}

export function createStatus(chain: IBeaconChain): Status {
  const head = chain.forkChoice.head()!;
  return {
    forkDigest: chain.currentForkDigest,
    finalizedRoot: head.finalizedCheckpoint.epoch === GENESIS_EPOCH ? ZERO_HASH : head.finalizedCheckpoint.root,
    finalizedEpoch: head.finalizedCheckpoint.epoch,
    headRoot: head.blockRoot,
    headSlot: head.slot,
  };
}

export async function syncPeersStatus(reps: IReputationStore, network: INetwork, status: Status): Promise<void> {
  await Promise.all(
    network.getPeers().map(async (peerId) => {
      try {
        reps.get(peerId.toB58String()).latestStatus = await network.reqResp.status(peerId, status);
        // eslint-disable-next-line no-empty
      } catch {}
    })
  );
}

/**
 * Check supportedProtocols.
 */
export async function getPeerSupportedProtocols(
  config: IBeaconConfig,
  reps: IReputationStore,
  peerId: PeerId,
  reqResp: IReqResp
): Promise<Method[]> {
  const latestStatus = reps.getFromPeerId(peerId).latestStatus!;
  if (!latestStatus || latestStatus.finalizedEpoch === GENESIS_EPOCH) {
    return [];
  }
  const finalizedBlock = await reqResp.beaconBlocksByRoot(peerId, [latestStatus.finalizedRoot] as List<Root>);
  if (!finalizedBlock || finalizedBlock.length !== 1) {
    return [];
  }
  const parentRoot = finalizedBlock[0].message.parentRoot;
  const parentBlock = await reqResp.beaconBlocksByRoot(peerId, [parentRoot] as List<Root>);
  if (!parentBlock || parentBlock.length !== 1) {
    return [];
  }
  const supportedProtocols = [Method.BeaconBlocksByRoot];
  const testReqResp: BeaconBlocksByRangeRequest = {
    startSlot: parentBlock[0].message.slot,
    count: 2,
    step: finalizedBlock[0].message.slot - parentBlock[0].message.slot,
  };
  const blocks = await reqResp.beaconBlocksByRange(peerId, testReqResp);
  if (blocks && blocks.length === 2) {
    const block0Root = config.types.BeaconBlock.hashTreeRoot(blocks[0].message);
    const block1Root = config.types.BeaconBlock.hashTreeRoot(blocks[1].message);
    if (
      config.types.Root.equals(parentRoot, block0Root) &&
      config.types.Root.equals(latestStatus.finalizedRoot, block1Root)
    ) {
      supportedProtocols.push(Method.BeaconBlocksByRange);
    }
  }
  return supportedProtocols;
}

/**
 * Get best head from peers that support beacon_blocks_by_range.
 */
export function getBestHead(
  peers: PeerId[],
  reps: IReputationStore
): {slot: number; root: Root; supportedProtocols: Method[]} {
  return peers
    .map((peerId) => {
      const {latestStatus, supportedProtocols} = reps.get(peerId.toB58String());
      return latestStatus
        ? {slot: latestStatus.headSlot, root: latestStatus.headRoot, supportedProtocols}
        : {slot: 0, root: ZERO_HASH, supportedProtocols};
    })
    .reduce(
      (head, peerStatus) => {
        return peerStatus.supportedProtocols.includes(Method.BeaconBlocksByRange) && peerStatus.slot >= head.slot
          ? peerStatus
          : head;
      },
      {slot: 0, root: ZERO_HASH, supportedProtocols: []}
    );
}

/**
 * Get best peer that support beacon_blocks_by_range.
 */
export function getBestPeer(config: IBeaconConfig, peers: PeerId[], reps: IReputationStore): PeerId {
  const {root} = getBestHead(peers, reps);
  return peers.find((peerId) =>
    config.types.Root.equals(root, reps.get(peerId.toB58String()).latestStatus?.headRoot || ZERO_HASH)
  )!;
}

/**
 * Check if a peer is good to be a best peer.
 */
export function checkBestPeer(peer: PeerId, forkChoice: ILMDGHOST, network: INetwork, reps: IReputationStore): boolean {
  if (!peer) return false;
  if (!network.getPeers().includes(peer)) return false;
  if (!reps.getFromPeerId(peer).latestStatus) return false;
  const headSlot = forkChoice.headBlockSlot();
  return reps.getFromPeerId(peer).latestStatus!.headSlot > headSlot;
}
