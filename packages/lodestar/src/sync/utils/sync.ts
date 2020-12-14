import PeerId from "peer-id";
import {AbortSignal} from "abort-controller";
import {SlotRoot} from "@chainsafe/lodestar-types";
import {Checkpoint, SignedBeaconBlock, Slot, Status, Root} from "@chainsafe/lodestar-types";
import {sleep} from "@chainsafe/lodestar-utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {getStatusProtocols, INetwork, IReqResp} from "../../network";
import {ISlotRange} from "../interface";
import {IBeaconChain} from "../../chain";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {getBlockRange, isValidChainOfBlocks, sortBlocks} from "./blocks";
import {ILogger} from "@chainsafe/lodestar-utils";
import {toHexString} from "@chainsafe/ssz";
import {blockToHeader} from "@chainsafe/lodestar-beacon-state-transition";
import {GENESIS_EPOCH, ZERO_HASH} from "../../constants";
import {IPeerMetadataStore} from "../../network/peers/interface";
import {getSyncPeers} from "./peers";

// timeout for getBlockRange is 3 minutes
const GET_BLOCK_RANGE_TIMEOUT = 3 * 60 * 1000;

export function getHighestCommonSlot(peerStatuses: (Status | null)[]): Slot {
  const slotStatuses = peerStatuses.reduce<Map<Slot, number>>((current, status) => {
    if (status && current.has(status.headSlot)) {
      current.set(status.headSlot, current.get(status.headSlot)! + 1);
    } else if (status) {
      current.set(status.headSlot, 1);
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

export function getCommonFinalizedCheckpoint(
  config: IBeaconConfig,
  peerStatuses: (Status | null)[]
): Checkpoint | null {
  const checkpointVotes = peerStatuses.reduce<Map<string, {checkpoint: Checkpoint; votes: number}>>(
    (current, status) => {
      if (!status) {
        return current;
      }
      const peerCheckpoint = getStatusFinalizedCheckpoint(status);
      const root = toHexString(config.types.Checkpoint.hashTreeRoot(peerCheckpoint));
      if (current.has(root)) {
        current.get(root)!.votes++;
      } else {
        current.set(root, {checkpoint: peerCheckpoint, votes: 1});
      }
      return current;
    },
    new Map()
  );
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
  reqResp: IReqResp,
  getPeers: () => Promise<PeerId[]>,
  signal?: AbortSignal
): (source: AsyncIterable<ISlotRange>) => AsyncGenerator<SignedBeaconBlock[] | null> {
  return async function* (source) {
    for await (const slotRange of source) {
      let peers = await getPeers();
      let retry = 0;
      while (peers.length === 0 && retry < 5) {
        logger.info("Waiting for peers...");
        await sleep(6000, signal);
        peers = await getPeers();
        retry++;
      }
      if (peers.length === 0) {
        logger.error("Can't find new peers");
        yield null;
        return;
      }
      try {
        // a work around of timeout issue that cause our sync stall
        let timer: NodeJS.Timeout | null = null;
        yield (await Promise.race([
          getBlockRange(logger, reqResp, peers, slotRange),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              reject(new Error("beacon_blocks_by_range timeout"));
            }, GET_BLOCK_RANGE_TIMEOUT);
          }),
        ])) as SignedBeaconBlock[] | null;
        if (timer) clearTimeout(timer);
      } catch (e) {
        logger.debug("Failed to get block range", {...slotRange}, e);
        yield null;
        return;
      }
    }
  };
}

export function validateBlocks(
  config: IBeaconConfig,
  chain: IBeaconChain,
  logger: ILogger,
  onBlockVerificationFail: () => void
): (source: AsyncIterable<SignedBeaconBlock[]>) => AsyncGenerator<SignedBeaconBlock[]> {
  return async function* (source) {
    for await (const blockChunk of source) {
      if (blockChunk.length === 0) {
        continue;
      }
      const head = blockToHeader(config, (await chain.getHeadBlock())!.message);
      if (isValidChainOfBlocks(config, head, blockChunk)) {
        yield blockChunk;
      } else {
        logger.warn("Hash chain doesnt match!", {
          headSlot: head.slot,
          headHash: toHexString(config.types.BeaconBlockHeader.hashTreeRoot(head)),
          fromSlot: blockChunk[0].message.slot,
          toSlot: blockChunk[blockChunk.length - 1].message.slot,
        });
        //discard blocks and trigger resync so we try to fetch blocks again
        onBlockVerificationFail();
      }
    }
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
 * @param lastProcessedBlock
 * @param trusted
 */
export function processSyncBlocks(
  config: IBeaconConfig,
  chain: IBeaconChain,
  logger: ILogger,
  isInitialSync: boolean,
  lastProcessedBlock: SlotRoot,
  trusted = false
): (source: AsyncIterable<SignedBeaconBlock[] | null>) => Promise<Slot | null> {
  return async (source) => {
    let blockBuffer: SignedBeaconBlock[] = [];
    let lastProcessedSlot: Slot | null = null;
    let {slot: headSlot, root: headRoot} = lastProcessedBlock;
    for await (const blocks of source) {
      if (!blocks) {
        // failed to fetch range, trigger sync to retry
        logger.warn("Failed to get blocks for range", {headSlot});
        return headSlot;
      }
      logger.info("Imported blocks for slots", {blocks: blocks.map((block) => block.message.slot).join(",")});
      blockBuffer.push(...blocks);
    }
    blockBuffer = sortBlocks(blockBuffer);
    // can't check linear chain for last block
    // so we don't want to import it
    while (blockBuffer.length > 1) {
      const signedBlock = blockBuffer.shift()!;
      const nextBlock = blockBuffer[0];
      const block = signedBlock.message;
      const blockRoot = config.types.BeaconBlock.hashTreeRoot(block);
      // only import blocks that's part of a linear chain
      if (
        !isInitialSync ||
        (isInitialSync &&
          block.slot > headSlot! &&
          config.types.Root.equals(headRoot!, block.parentRoot) &&
          config.types.Root.equals(blockRoot, nextBlock.message.parentRoot))
      ) {
        await chain.receiveBlock(signedBlock, trusted);
        headRoot = blockRoot;
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

export async function createStatus(chain: IBeaconChain): Promise<Status> {
  const head = chain.forkChoice.getHead();
  const finalizedCheckpoint = chain.forkChoice.getFinalizedCheckpoint();
  return {
    forkDigest: await chain.getForkDigest(),
    finalizedRoot: finalizedCheckpoint.epoch === GENESIS_EPOCH ? ZERO_HASH : finalizedCheckpoint.root,
    finalizedEpoch: finalizedCheckpoint.epoch,
    headRoot: head.blockRoot,
    headSlot: head.slot,
  };
}

export async function syncPeersStatus(network: INetwork, status: Status): Promise<void> {
  await Promise.all(
    network.getPeers({connected: true, supportsProtocols: getStatusProtocols()}).map(async (peer) => {
      try {
        network.peerMetadata.setStatus(peer.id, await network.reqResp.status(peer.id, status));
        // eslint-disable-next-line no-empty
      } catch {}
    })
  );
}

/**
 * Get best head from peers that support beacon_blocks_by_range.
 */
export function getBestHead(peers: PeerId[], peerMetaStore: IPeerMetadataStore): {slot: number; root: Root} {
  return peers
    .map((peerId) => {
      const status = peerMetaStore.getStatus(peerId);
      return status ? {slot: status.headSlot, root: status.headRoot} : {slot: 0, root: ZERO_HASH};
    })
    .reduce(
      (head, peerStatus) => {
        return peerStatus.slot >= head.slot ? peerStatus : head;
      },
      {slot: 0, root: ZERO_HASH}
    );
}

/**
 * Get best peer that support beacon_blocks_by_range.
 */
export function getBestPeer(config: IBeaconConfig, peers: PeerId[], peerMetaStore: IPeerMetadataStore): PeerId {
  const {root} = getBestHead(peers, peerMetaStore);
  return peers.find((peerId) =>
    config.types.Root.equals(root, peerMetaStore.getStatus(peerId)?.headRoot || ZERO_HASH)
  )!;
}

/**
 * Check if a peer is good to be a best peer.
 */
export function checkBestPeer(peer: PeerId, forkChoice: IForkChoice, network: INetwork): boolean {
  return getBestPeerCandidates(forkChoice, network).includes(peer);
}

/**
 * Return candidate for gest peer.
 */
export function getBestPeerCandidates(forkChoice: IForkChoice, network: INetwork): PeerId[] {
  return getSyncPeers(
    network,
    (peer) => {
      const status = network.peerMetadata.getStatus(peer);
      return !!status && status.headSlot > forkChoice.getHead().slot;
    },
    10
  );
}

/**
 * Some clients may send orphaned/non-canonical blocks.
 * Check each block should link to a previous parent block and be a parent of next block.
 * Throw errors if they're not so that it'll fetch again
 */
export function checkLinearChainSegment(
  config: IBeaconConfig,
  blocks: SignedBeaconBlock[] | null,
  ancestorRoot: Root | null = null
): void {
  if (!blocks || blocks.length <= 1) throw new Error("Not enough blocks to validate");
  let parentRoot = ancestorRoot;
  blocks.forEach((block) => {
    if (parentRoot && !config.types.Root.equals(block.message.parentRoot, parentRoot)) {
      throw new Error(`Block ${block.message.slot} does not link to parent ${toHexString(parentRoot)}`);
    }
    parentRoot = config.types.BeaconBlock.hashTreeRoot(block.message);
  });
}
