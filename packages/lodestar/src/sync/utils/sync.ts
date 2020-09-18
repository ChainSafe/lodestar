import PeerId from "peer-id";
import {Checkpoint, SignedBeaconBlock, Slot, Status, Root} from "@chainsafe/lodestar-types";
import {sleep} from "@chainsafe/lodestar-utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {getStatusProtocols, getSyncProtocols, INetwork, IReqResp} from "../../network";
import {ISlotRange, ISyncCheckpoint} from "../interface";
import {IBeaconChain} from "../../chain";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {getBlockRange, isValidChainOfBlocks, sortBlocks} from "./blocks";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {toHexString} from "@chainsafe/ssz";
import {blockToHeader} from "@chainsafe/lodestar-beacon-state-transition";
import {GENESIS_EPOCH, ZERO_HASH} from "../../constants";
import {IPeerMetadataStore} from "../../network/peers/interface";

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
  lastProcessedBlock: ISyncCheckpoint | null,
  trusted = false
): (source: AsyncIterable<SignedBeaconBlock[] | null>) => Promise<Slot | null> {
  return async (source) => {
    let blockBuffer: SignedBeaconBlock[] = [];
    let lastProcessedSlot: Slot | null = null;
    let headRoot = isInitialSync ? lastProcessedBlock?.blockRoot : null;
    let headSlot = isInitialSync ? lastProcessedBlock!.slot : chain.forkChoice.getHead().slot;
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
  const head = chain.forkChoice.getHead();
  const finalizedCheckpoint = chain.forkChoice.getFinalizedCheckpoint();
  return {
    forkDigest: chain.currentForkDigest,
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
  if (!peer) return false;
  if (
    !network
      .getPeers({connected: true, supportsProtocols: getSyncProtocols()})
      .map((peer) => peer.id)
      .includes(peer)
  )
    return false;
  const status = network.peerMetadata.getStatus(peer);
  if (!status) return false;
  const headSlot = forkChoice.getHead().slot;
  return (status?.headSlot ?? 0) > headSlot;
}
