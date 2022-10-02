import {PeerId} from "@libp2p/interface-peer-id";
import {peerIdFromString} from "@libp2p/peer-id";
import {IChainForkConfig} from "@lodestar/config";
import {ILogger, pruneSetToMax} from "@lodestar/utils";
import {allForks, Root, RootHex} from "@lodestar/types";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {INetwork, NetworkEvent, PeerAction} from "../network/index.js";
import {IBeaconChain} from "../chain/index.js";
import {IMetrics} from "../metrics/index.js";
import {shuffle} from "../util/shuffle.js";
import {byteArrayEquals} from "../util/bytes.js";
import {BlockError, BlockErrorCode} from "../chain/errors/index.js";
import {wrapError} from "../util/wrapError.js";
import {PendingBlock, PendingBlockStatus} from "./interface.js";
import {
  getDescendantBlocks,
  getAllDescendantBlocks,
  getLowestPendingUnknownParents,
} from "./utils/pendingBlocksTree.js";
import {SyncOptions} from "./options.js";

const MAX_ATTEMPTS_PER_BLOCK = 5;
const MAX_KNOWN_BAD_BLOCKS = 500;
const MAX_PENDING_BLOCKS = 100;

export class UnknownBlockSync {
  /**
   * block RootHex -> PendingBlock. To avoid finding same root at the same time
   */
  private readonly pendingBlocks = new Map<RootHex, PendingBlock>();
  private readonly knownBadBlocks = new Set<RootHex>();

  constructor(
    private readonly config: IChainForkConfig,
    private readonly network: INetwork,
    private readonly chain: IBeaconChain,
    private readonly logger: ILogger,
    private readonly metrics: IMetrics | null,
    opts?: SyncOptions
  ) {
    if (!opts?.disableUnknownBlockSync) {
      this.network.events.on(NetworkEvent.unknownBlockParent, this.onUnknownBlock);
      this.network.events.on(NetworkEvent.peerConnected, this.triggerUnknownBlockSearch);
    }

    if (metrics) {
      metrics.syncUnknownBlock.pendingBlocks.addCollect(() =>
        metrics.syncUnknownBlock.pendingBlocks.set(this.pendingBlocks.size)
      );
      metrics.syncUnknownBlock.knownBadBlocks.addCollect(() =>
        metrics.syncUnknownBlock.knownBadBlocks.set(this.knownBadBlocks.size)
      );
    }
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
      this.triggerUnknownBlockSearch();
      this.metrics?.syncUnknownBlock.requests.inc();
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
      this.pendingBlocks.set(blockRootHex, pendingBlock);
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
    // Cheap early stop to prevent calling the network.getConnectedPeers()
    if (this.pendingBlocks.size === 0) {
      return;
    }

    // If the node loses all peers with pending unknown blocks, the sync will stall
    const connectedPeers = this.network.getConnectedPeers();
    if (connectedPeers.length === 0) {
      return;
    }

    for (const block of getLowestPendingUnknownParents(this.pendingBlocks)) {
      this.downloadParentBlock(block, connectedPeers).catch((e) => {
        this.logger.error("Unexpect error - downloadParentBlock", {}, e);
      });
    }
  };

  private async downloadParentBlock(block: PendingBlock, connectedPeers: PeerId[]): Promise<void> {
    if (block.status !== PendingBlockStatus.pending) {
      return;
    }

    block.status = PendingBlockStatus.fetching;
    const res = await wrapError(this.fetchUnknownBlockRoot(fromHexString(block.parentBlockRootHex), connectedPeers));
    block.status = PendingBlockStatus.pending;

    if (res.err) this.metrics?.syncUnknownBlock.downloadedBlocksError.inc();
    else this.metrics?.syncUnknownBlock.downloadedBlocksSuccess.inc();

    if (!res.err) {
      const {signedBlock, peerIdStr} = res.result;
      const parentSlot = signedBlock.message.slot;
      const finalizedSlot = this.chain.forkChoice.getFinalizedBlock().slot;
      if (this.chain.forkChoice.hasBlock(signedBlock.message.parentRoot)) {
        // Bingo! Process block. Add to pending blocks anyway for recycle the cache that prevents duplicate processing
        this.processBlock(this.addToPendingBlocks(signedBlock, peerIdStr)).catch((e) => {
          this.logger.error("Unexpect error - processBlock", {}, e);
        });
      } else if (parentSlot <= finalizedSlot) {
        // the common ancestor of the downloading chain and canonical chain should be at least the finalized slot and
        // we should found it through forkchoice. If not, we should penalize all peers sending us this block chain
        // 0 - 1 - ... - n - finalizedSlot
        //                \
        //                parent 1 - parent 2 - ... - unknownParent block
        this.logger.error("Downloaded block parent is before finalized slot", {
          finalizedSlot,
          parentSlot,
          parentRoot: toHexString(this.config.getForkTypes(parentSlot).BeaconBlock.hashTreeRoot(signedBlock.message)),
        });
        this.removeAndDownscoreAllDescendants(block);
      } else {
        this.onUnknownBlock(signedBlock, peerIdStr);
      }
    } else {
      // parentSlot > finalizedSlot, continue downloading parent of parent
      block.downloadAttempts++;
      const errorData = {root: block.parentBlockRootHex, attempts: block.downloadAttempts};
      if (block.downloadAttempts > MAX_ATTEMPTS_PER_BLOCK) {
        // Give up on this block and assume it does not exist, penalizing all peers as if it was a bad block
        this.logger.error("Ignoring unknown block root after many failed downloads", errorData, res.err);
        this.removeAndDownscoreAllDescendants(block);
      } else {
        // Try again when a new peer connects, its status changes, or a new unknownBlockParent event happens
        this.logger.debug("Error downloading unknown block root", errorData, res.err);
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
    // At gossip time, it's critical to keep a good number of mesh peers.
    // To do that, the Gossip Job Wait Time should be consistently <3s to avoid the behavior penalties in gossip
    // Gossip Job Wait Time depends on the BLS Job Wait Time
    // so `blsVerifyOnMainThread = true`: we want to verify signatures immediately without affecting the bls thread pool.
    // otherwise we can't utilize bls thread pool capacity and Gossip Job Wait Time can't be kept low consistently.
    // See https://github.com/ChainSafe/lodestar/issues/3792
    const res = await wrapError(
      this.chain.processBlock(pendingBlock.signedBlock, {ignoreIfKnown: true, blsVerifyOnMainThread: true})
    );
    pendingBlock.status = PendingBlockStatus.pending;

    if (res.err) this.metrics?.syncUnknownBlock.processedBlocksError.inc();
    else this.metrics?.syncUnknownBlock.processedBlocksSuccess.inc();

    if (!res.err) {
      this.pendingBlocks.delete(pendingBlock.blockRootHex);

      // Send child blocks to the processor
      for (const descendantBlock of getDescendantBlocks(pendingBlock.blockRootHex, this.pendingBlocks)) {
        this.processBlock(descendantBlock).catch((e) => {
          this.logger.error("Unexpect error - processBlock", {}, e);
        });
      }
    } else {
      const errorData = {root: pendingBlock.blockRootHex, slot: pendingBlock.signedBlock.message.slot};
      if (res.err instanceof BlockError) {
        switch (res.err.type.code) {
          // This cases are already handled with `{ignoreIfKnown: true}`
          // case BlockErrorCode.ALREADY_KNOWN:
          // case BlockErrorCode.GENESIS_BLOCK:

          case BlockErrorCode.PARENT_UNKNOWN:
          case BlockErrorCode.PRESTATE_MISSING:
            // Should no happen, mark as pending to try again latter
            this.logger.error("Attempted to process block but its parent was still unknown", errorData, res.err);
            pendingBlock.status = PendingBlockStatus.pending;
            break;

          case BlockErrorCode.EXECUTION_ENGINE_ERROR:
            // Removing the block(s) without penalizing the peers, hoping for EL to
            // recover on a latter download + verify attempt
            this.removeAllDescendants(pendingBlock);
            break;

          default:
            // Block is not correct with respect to our chain. Log error loudly
            this.logger.error("Error processing block from unknown parent sync", errorData, res.err);
            this.removeAndDownscoreAllDescendants(pendingBlock);
        }
      }

      // Probably a queue error or something unwanted happened, mark as pending to try again latter
      else {
        this.logger.error("Unknown error processing block from unknown parent sync", errorData, res.err);
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
        const [signedBlock] = await this.network.reqResp.beaconBlocksByRoot(peer, [blockRoot]);

        // Peer does not have the block, try with next peer
        if (signedBlock === undefined) {
          continue;
        }

        // Verify block root is correct
        const block = signedBlock.message;
        const receivedBlockRoot = this.config.getForkTypes(block.slot).BeaconBlock.hashTreeRoot(block);
        if (!byteArrayEquals(receivedBlockRoot, blockRoot)) {
          throw Error(`Wrong block received by peer, expected ${toHexString(receivedBlockRoot)} got ${blockRootHex}`);
        }

        return {signedBlock, peerIdStr: peer.toString()};
      } catch (e) {
        this.logger.debug(
          "Error fetching UnknownBlockRoot",
          {attempt: i, blockRootHex, peer: peer.toString()},
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
    const badPendingBlocks = this.removeAllDescendants(block);

    for (const block of badPendingBlocks) {
      this.knownBadBlocks.add(block.blockRootHex);
      this.logger.error("Banning unknown parent block", {
        root: block.blockRootHex,
        slot: block.signedBlock.message.slot,
      });

      for (const peerIdStr of block.peerIdStrs) {
        // TODO: Refactor peerRpcScores to work with peerIdStr only
        const peer = peerIdFromString(peerIdStr);
        this.network.reportPeer(peer, PeerAction.LowToleranceError, "BadBlockByRoot");
      }
    }

    // Prune knownBadBlocks
    pruneSetToMax(this.knownBadBlocks, MAX_KNOWN_BAD_BLOCKS);
  }

  private removeAllDescendants(block: PendingBlock): PendingBlock[] {
    // Get all blocks that are a descendat of this one
    const badPendingBlocks = [block, ...getAllDescendantBlocks(block.blockRootHex, this.pendingBlocks)];

    this.metrics?.syncUnknownBlock.removedBlocks.inc(badPendingBlocks.length);

    for (const block of badPendingBlocks) {
      this.pendingBlocks.delete(block.blockRootHex);
      this.logger.error("Removing unknown parent block", {
        root: block.blockRootHex,
        slot: block.signedBlock.message.slot,
      });
    }

    return badPendingBlocks;
  }
}
