import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {allForks, Root, RootHex} from "@chainsafe/lodestar-types";
import {fromHexString, List, toHexString} from "@chainsafe/ssz";
import {INetwork, NetworkEvent, PeerAction} from "../network";
import {IBeaconChain} from "../chain";
import {IMetrics} from "../metrics";
import {shuffle} from "../util/shuffle";
import {byteArrayEquals} from "../util/bytes";
import PeerId from "peer-id";
import {BlockError, BlockErrorCode} from "../chain/errors";
import {wrapError} from "../util/wrapError";
import {pruneSetToMax} from "../util/map";

const MAX_ATTEMPTS_PER_BLOCK = 5;
const MAX_KNOWN_BAD_BLOCKS = 500;
const MAX_PENDING_BLOCKS = 100;

export type PendingBlock = {
  blockRootHex: RootHex;
  parentBlockRootHex: RootHex;
  signedBlock: allForks.SignedBeaconBlock;
  peerIdStrs: Set<string>;
  status: PendingBlockStatus;
  downloadAttempts: number;
};
export enum PendingBlockStatus {
  pending = "pending",
  fetching = "fetching",
  processing = "processing",
}

export class UnknownBlockSync {
  /**
   * block RootHex -> PendingBlock. To avoid finding same root at the same time
   */
  private readonly pendingBlocks = new Map<RootHex, PendingBlock>();
  private readonly knownBadBlocks = new Set<RootHex>();

  constructor(
    private readonly config: IBeaconConfig,
    private readonly network: INetwork,
    private readonly chain: IBeaconChain,
    private readonly logger: ILogger,
    private readonly metrics: IMetrics | null
  ) {
    this.network.events.on(NetworkEvent.unknownBlockParent, this.onUnknownBlock);
    this.network.events.on(NetworkEvent.peerConnected, this.triggerUnknownBlockSearch);
  }

  close(): void {
    this.network.events.off(NetworkEvent.unknownBlockParent, this.onUnknownBlock);
    this.network.events.off(NetworkEvent.peerConnected, this.triggerUnknownBlockSearch);
  }

  /**
   * Process an unknownBlockParent event and register the block in `pendingBlocks` Map.
   */
  private onUnknownBlock = (signedBlock: allForks.SignedBeaconBlock, peerIdStr: string): void => {
    try {
      this.addToPendingBlocks(signedBlock, peerIdStr);
      void this.triggerUnknownBlockSearch();
    } catch (e) {
      this.logger.error("Error handling unknownBlockParent event", {}, e as Error);
    }
  };

  private addToPendingBlocks(signedBlock: allForks.SignedBeaconBlock, peerIdStr: string): PendingBlock {
    const block = signedBlock.message;
    const blockRoot = this.config.getForkTypes(block.slot).BeaconBlock.hashTreeRoot(block);
    const blockRootHex = toHexString(blockRoot);
    const parentBlockRootHex = toHexString(block.parentRoot);

    let pendingBlock = this.pendingBlocks.get(blockRootHex);
    if (!pendingBlock) {
      pendingBlock = {
        blockRootHex,
        parentBlockRootHex,
        signedBlock,
        peerIdStrs: new Set(),
        status: PendingBlockStatus.pending,
        downloadAttempts: 0,
      };
    }
    pendingBlock.peerIdStrs.add(peerIdStr);

    // Limit pending blocks to prevent DOS attacks that cause OOM
    const prunedItemCount = pruneSetToMax(this.pendingBlocks, MAX_PENDING_BLOCKS);
    if (prunedItemCount > 0) {
      this.logger.warn(`Pruned ${prunedItemCount} pending blocks from UnknownBlockSync`);
    }

    return pendingBlock;
  }

  /**
   * Gather tip parent blocks with unknown parent and do a search for all of them
   */
  private triggerUnknownBlockSearch = (): void => {
    const blocks = this.pendingBlocks.size > 0 && getLowestPendingUnknownParents(this.pendingBlocks);

    // Cheap early stop to prevent calling the network.getConnectedPeers()
    if (!blocks) {
      return;
    }

    // If the node loses all peers with pending unknown blocks, the sync will stall
    const connectedPeers = this.network.getConnectedPeers();
    if (connectedPeers.length) {
      return;
    }

    for (const block of blocks) {
      void this.downloadParentBlock(block, connectedPeers);
    }
  };

  private async downloadParentBlock(block: PendingBlock, connectedPeers: PeerId[]): Promise<void> {
    if (block.status !== PendingBlockStatus.pending) {
      return;
    }

    this.metrics?.syncUnknownParentSyncs.inc(1);

    block.status = PendingBlockStatus.fetching;
    const res = await wrapError(this.fetchUnknownBlockRoot(fromHexString(block.parentBlockRootHex), connectedPeers));
    block.status = PendingBlockStatus.pending;

    if (!res.err) {
      const {signedBlock, peerIdStr} = res.result;
      if (this.chain.forkChoice.hasBlock(signedBlock.message.parentRoot)) {
        // Bingo! Process block. Add to pending blocks anyway for recycle the cache that prevents duplicate processing
        void this.processBlock(this.addToPendingBlocks(signedBlock, peerIdStr));
      } else {
        void this.onUnknownBlock(signedBlock, peerIdStr);
      }
    } else {
      // TODO: Log error

      // Can't find parent
      block.downloadAttempts++;
      if (block.downloadAttempts > MAX_ATTEMPTS_PER_BLOCK) {
        // Give up on this block and assume it does not exist, penalizing all peers as if it was a bad block
        this.removeAndDownscoreAllDescendants(block);
      }
    }
  }

  /**
   * Send block to the processor awaiting completition. If processed successfully, send all children to the processor.
   * On error, remove and downscore all descendants.
   */
  private async processBlock(pendingBlock: PendingBlock): Promise<void> {
    if (pendingBlock.status === PendingBlockStatus.processing) {
      return;
    }

    pendingBlock.status = PendingBlockStatus.processing;
    const res = await wrapError(this.chain.processBlock(pendingBlock.signedBlock));
    pendingBlock.status = PendingBlockStatus.pending;

    if (!res.err) {
      this.pendingBlocks.delete(pendingBlock.blockRootHex);

      // Send child blocks to the processor
      for (const descendantBlock of getDescendantBlocks(pendingBlock.blockRootHex, this.pendingBlocks)) {
        void this.processBlock(descendantBlock);
      }
    } else {
      if (res.err instanceof BlockError) {
        // Some race-condition imported the block earlier, that's okay ignore
        if (res.err.type.code === BlockErrorCode.ALREADY_KNOWN) {
          this.pendingBlocks.delete(pendingBlock.blockRootHex);
        }

        // Should no happen, mark as pending to try again latter
        else if (res.err.type.code === BlockErrorCode.PARENT_UNKNOWN) {
          pendingBlock.status = PendingBlockStatus.pending;
        }

        // Block is not correct with respect to our chain. Log error loudly
        else {
          this.logger.error(
            "Error processing block from unknown parent sync",
            {slot: pendingBlock.signedBlock.message.slot, root: pendingBlock.blockRootHex},
            res.err
          );

          this.removeAndDownscoreAllDescendants(pendingBlock);
        }
      }

      // Probably a queue error or something unwanted happened, mark as pending to try again latter
      else {
        pendingBlock.status = PendingBlockStatus.pending;
      }
    }
  }

  /**
   * Fetches the parent of a block by root from a set of shuffled peers.
   * Will attempt a max of `MAX_ATTEMPTS_PER_BLOCK` on different peers if connectPeers.length > MAX_ATTEMPTS_PER_BLOCK.
   * Also verifies the received block root + returns the peer that provided the block for future downscoring.
   */
  private async fetchUnknownBlockRoot(
    blockRoot: Root,
    connectedPeers: PeerId[]
  ): Promise<{signedBlock: allForks.SignedBeaconBlock; peerIdStr: string}> {
    const shuffledPeers = shuffle(connectedPeers);
    const blockRootHex = toHexString(blockRoot);

    let lastError: Error | null = null;
    for (let i = 0; i < MAX_ATTEMPTS_PER_BLOCK; i++) {
      const peer = shuffledPeers[i % shuffledPeers.length];
      try {
        const [signedBlock] = await this.network.reqResp.beaconBlocksByRoot(peer, [blockRoot] as List<Root>);

        // Peer does not have the block, try with next peer
        if (!signedBlock) {
          continue;
        }

        // Verify block root is correct
        const block = signedBlock.message;
        const receivedBlockRoot = this.config.getForkTypes(block.slot).BeaconBlock.hashTreeRoot(block);
        if (!byteArrayEquals(receivedBlockRoot, blockRoot)) {
          throw Error(`Wrong block received by peer, expected ${toHexString(receivedBlockRoot)} got ${blockRootHex}`);
        }

        return {signedBlock, peerIdStr: peer.toB58String()};
      } catch (e) {
        this.logger.debug(
          "Error fetching UnknownBlockRoot",
          {attempt: i, blockRootHex, peer: peer.toB58String()},
          e as Error
        );
        lastError = e as Error;
      }
    }

    if (lastError) {
      lastError.message = `Error fetching UnknownBlockRoot after ${MAX_ATTEMPTS_PER_BLOCK} attempts: ${lastError.message}`;
      throw lastError;
    } else {
      throw Error(`Error fetching UnknownBlockRoot after ${MAX_ATTEMPTS_PER_BLOCK}: unknown error`);
    }
  }

  /**
   * Gets all descendant blocks of `block` recursively from `pendingBlocks`.
   * Assumes that if a parent block does not exist or is not processable, all descendant blocks are bad too.
   * Downscore all peers that have referenced any of this bad blocks. May report peers multiple times if they have
   * referenced more than one bad block.
   */
  private removeAndDownscoreAllDescendants(block: PendingBlock): void {
    // Get all blocks that are a descendat of this one
    const descendantBlocks = getAllDescendantBlocks(block.blockRootHex, this.pendingBlocks);

    for (const badPendingBlock of [block, ...descendantBlocks]) {
      this.pendingBlocks.delete(badPendingBlock.blockRootHex);
      this.knownBadBlocks.add(badPendingBlock.blockRootHex);

      for (const peerIdStr of badPendingBlock.peerIdStrs) {
        // TODO: Refactor peerRpcScores to work with peerIdStr only
        const peer = PeerId.createFromB58String(peerIdStr);
        this.network.peerRpcScores.applyAction(peer, PeerAction.LowToleranceError, "BadBlockByRoot");
      }
    }

    // Prune knownBadBlocks
    pruneSetToMax(this.knownBadBlocks, MAX_KNOWN_BAD_BLOCKS);
  }
}

function getAllDescendantBlocks(
  blockRootHex: RootHex,
  blocks: Map<RootHex, PendingBlock>,
  descendantBlocks: PendingBlock[] = []
): PendingBlock[] {
  const firstDescendantBlocks = getDescendantBlocks(blockRootHex, blocks);
  descendantBlocks.push(...firstDescendantBlocks);
  for (const firstDescendantBlock of firstDescendantBlocks) {
    getAllDescendantBlocks(firstDescendantBlock.blockRootHex, blocks, descendantBlocks);
  }
  return descendantBlocks;
}

function getDescendantBlocks(blockRootHex: RootHex, blocks: Map<RootHex, PendingBlock>): PendingBlock[] {
  const descendantBlocks: PendingBlock[] = [];

  for (const block of blocks.values()) {
    if (block.parentBlockRootHex === blockRootHex) {
      descendantBlocks.push(block);
    }
  }

  return descendantBlocks;
}

function getLowestPendingUnknownParents(blocks: Map<RootHex, PendingBlock>): PendingBlock[] {
  const blocksToFetch: PendingBlock[] = [];

  for (const block of blocks.values()) {
    if (block.status === PendingBlockStatus.pending && !blocks.has(block.parentBlockRootHex)) {
      blocksToFetch.push(block);
    }
  }

  return blocksToFetch;
}
