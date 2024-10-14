import {ChainForkConfig} from "@lodestar/config";
import {Logger, fromHex, pruneSetToMax, toRootHex} from "@lodestar/utils";
import {Root, RootHex, deneb} from "@lodestar/types";
import {INTERVALS_PER_SLOT} from "@lodestar/params";
import {sleep} from "@lodestar/utils";
import {INetwork, NetworkEvent, NetworkEventData, PeerAction} from "../network/index.js";
import {PeerIdStr} from "../util/peerId.js";
import {IBeaconChain} from "../chain/index.js";
import {BlockInput, BlockInputType, NullBlockInput} from "../chain/blocks/types.js";
import {Metrics} from "../metrics/index.js";
import {shuffle} from "../util/shuffle.js";
import {byteArrayEquals} from "../util/bytes.js";
import {BlockError, BlockErrorCode} from "../chain/errors/index.js";
import {
  beaconBlocksMaybeBlobsByRoot,
  unavailableBeaconBlobsByRoot,
} from "../network/reqresp/beaconBlocksMaybeBlobsByRoot.js";
import {wrapError} from "../util/wrapError.js";
import {PendingBlock, PendingBlockStatus, PendingBlockType} from "./interface.js";
import {getDescendantBlocks, getAllDescendantBlocks, getUnknownAndAncestorBlocks} from "./utils/pendingBlocksTree.js";
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
  private readonly proposerBoostSecWindow: number;
  private readonly maxPendingBlocks;
  private subscribedToNetworkEvents = false;

  constructor(
    private readonly config: ChainForkConfig,
    private readonly network: INetwork,
    private readonly chain: IBeaconChain,
    private readonly logger: Logger,
    private readonly metrics: Metrics | null,
    private readonly opts?: SyncOptions
  ) {
    this.maxPendingBlocks = opts?.maxPendingBlocks ?? MAX_PENDING_BLOCKS;
    this.proposerBoostSecWindow = this.config.SECONDS_PER_SLOT / INTERVALS_PER_SLOT;

    if (metrics) {
      metrics.syncUnknownBlock.pendingBlocks.addCollect(() =>
        metrics.syncUnknownBlock.pendingBlocks.set(this.pendingBlocks.size)
      );
      metrics.syncUnknownBlock.knownBadBlocks.addCollect(() =>
        metrics.syncUnknownBlock.knownBadBlocks.set(this.knownBadBlocks.size)
      );
    }
  }

  subscribeToNetwork(): void {
    if (!this.opts?.disableUnknownBlockSync) {
      // cannot chain to the above if or the log will be incorrect
      if (!this.subscribedToNetworkEvents) {
        this.logger.verbose("UnknownBlockSync enabled.");
        this.network.events.on(NetworkEvent.unknownBlock, this.onUnknownBlock);
        this.network.events.on(NetworkEvent.unknownBlockInput, this.onUnknownBlockInput);
        this.network.events.on(NetworkEvent.unknownBlockParent, this.onUnknownParent);
        this.network.events.on(NetworkEvent.peerConnected, this.triggerUnknownBlockSearch);
        this.subscribedToNetworkEvents = true;
      }
    } else {
      this.logger.verbose("UnknownBlockSync disabled by disableUnknownBlockSync option.");
    }
  }

  unsubscribeFromNetwork(): void {
    this.logger.verbose("UnknownBlockSync disabled.");
    this.network.events.off(NetworkEvent.unknownBlock, this.onUnknownBlock);
    this.network.events.off(NetworkEvent.unknownBlockInput, this.onUnknownBlockInput);
    this.network.events.off(NetworkEvent.unknownBlockParent, this.onUnknownParent);
    this.network.events.off(NetworkEvent.peerConnected, this.triggerUnknownBlockSearch);
    this.subscribedToNetworkEvents = false;
  }

  close(): void {
    this.unsubscribeFromNetwork();
    // add more in the future if needed
  }

  isSubscribedToNetwork(): boolean {
    return this.subscribedToNetworkEvents;
  }

  /**
   * Process an unknownBlock event and register the block in `pendingBlocks` Map.
   */
  private onUnknownBlock = (data: NetworkEventData[NetworkEvent.unknownBlock]): void => {
    try {
      const unknownBlockType = this.addUnknownBlock(data.rootHex, data.peer);
      this.triggerUnknownBlockSearch();
      this.metrics?.syncUnknownBlock.requests.inc({type: unknownBlockType});
    } catch (e) {
      this.logger.debug("Error handling unknownBlock event", {}, e as Error);
    }
  };

  /**
   * Process an unknownBlockInput event and register the block in `pendingBlocks` Map.
   */
  private onUnknownBlockInput = (data: NetworkEventData[NetworkEvent.unknownBlockInput]): void => {
    try {
      const unknownBlockType = this.addUnknownBlock(data.blockInput, data.peer);
      this.triggerUnknownBlockSearch();
      this.metrics?.syncUnknownBlock.requests.inc({type: unknownBlockType});
    } catch (e) {
      this.logger.debug("Error handling unknownBlockInput event", {}, e as Error);
    }
  };

  /**
   * Process an unknownBlockParent event and register the block in `pendingBlocks` Map.
   */
  private onUnknownParent = (data: NetworkEventData[NetworkEvent.unknownBlockParent]): void => {
    try {
      this.addUnknownParent(data.blockInput, data.peer);
      this.triggerUnknownBlockSearch();
      this.metrics?.syncUnknownBlock.requests.inc({type: PendingBlockType.UNKNOWN_PARENT});
    } catch (e) {
      this.logger.debug("Error handling unknownBlockParent event", {}, e as Error);
    }
  };

  /**
   * When a blockInput comes with  an unknown parent:
   * - add the block to pendingBlocks with status downloaded, blockRootHex as key. This is similar to
   * an `onUnknownBlock` event, but the blocks is downloaded.
   * - add the parent root to pendingBlocks with status pending, parentBlockRootHex as key. This is
   * the same to an `onUnknownBlock` event with parentBlockRootHex as root.
   */
  private addUnknownParent(blockInput: BlockInput, peerIdStr: string): void {
    const block = blockInput.block.message;
    const blockRoot = this.config.getForkTypes(block.slot).BeaconBlock.hashTreeRoot(block);
    const blockRootHex = toRootHex(blockRoot);
    const parentBlockRootHex = toRootHex(block.parentRoot);

    // add 1 pending block with status downloaded
    let pendingBlock = this.pendingBlocks.get(blockRootHex);
    if (!pendingBlock) {
      pendingBlock = {
        blockRootHex,
        parentBlockRootHex,
        blockInput,
        peerIdStrs: new Set(),
        status: PendingBlockStatus.downloaded,
        downloadAttempts: 0,
      };
      this.pendingBlocks.set(blockRootHex, pendingBlock);
      this.logger.verbose("Added unknown block parent to pendingBlocks", {
        root: blockRootHex,
        parent: parentBlockRootHex,
      });
    }
    pendingBlock.peerIdStrs.add(peerIdStr);

    // add 1 pending block with status pending
    this.addUnknownBlock(parentBlockRootHex, peerIdStr);
  }

  private addUnknownBlock(
    blockInputOrRootHex: RootHex | BlockInput | NullBlockInput,
    peerIdStr?: string
  ): Exclude<PendingBlockType, PendingBlockType.UNKNOWN_PARENT> {
    let blockRootHex;
    let blockInput: BlockInput | NullBlockInput | null;
    let unknownBlockType: Exclude<PendingBlockType, PendingBlockType.UNKNOWN_PARENT>;

    if (typeof blockInputOrRootHex === "string") {
      blockRootHex = blockInputOrRootHex;
      blockInput = null;
      unknownBlockType = PendingBlockType.UNKNOWN_BLOCK;
    } else {
      if (blockInputOrRootHex.block !== null) {
        const {block} = blockInputOrRootHex;
        blockRootHex = toRootHex(this.config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message));
        unknownBlockType = PendingBlockType.UNKNOWN_BLOBS;
      } else {
        unknownBlockType = PendingBlockType.UNKNOWN_BLOCKINPUT;
        blockRootHex = blockInputOrRootHex.blockRootHex;
      }
      blockInput = blockInputOrRootHex;
    }

    let pendingBlock = this.pendingBlocks.get(blockRootHex);
    if (!pendingBlock) {
      pendingBlock = {
        unknownBlockType,
        blockRootHex,
        parentBlockRootHex: null,
        blockInput,
        peerIdStrs: new Set(),
        status: PendingBlockStatus.pending,
        downloadAttempts: 0,
      } as PendingBlock;
      this.pendingBlocks.set(blockRootHex, pendingBlock);

      this.logger.verbose("Added unknown block to pendingBlocks", {
        unknownBlockType,
        root: blockRootHex,
        slot: blockInput?.block?.message.slot ?? "unknown",
      });
    }

    if (peerIdStr) {
      pendingBlock.peerIdStrs.add(peerIdStr);
    }

    // Limit pending blocks to prevent DOS attacks that cause OOM
    const prunedItemCount = pruneSetToMax(this.pendingBlocks, this.maxPendingBlocks);
    if (prunedItemCount > 0) {
      this.logger.warn(`Pruned ${prunedItemCount} pending blocks from UnknownBlockSync`);
    }

    return unknownBlockType;
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
      this.logger.debug("No connected peers, skipping unknown block search.");
      return;
    }

    const {unknowns, ancestors} = getUnknownAndAncestorBlocks(this.pendingBlocks);
    // it's rare when there is no unknown block
    // see https://github.com/ChainSafe/lodestar/issues/5649#issuecomment-1594213550
    if (unknowns.length === 0) {
      let processedBlocks = 0;

      for (const block of ancestors) {
        // when this happens, it's likely the block and parent block are processed by head sync
        if (this.chain.forkChoice.hasBlockHex(block.parentBlockRootHex)) {
          processedBlocks++;
          this.processBlock(block).catch((e) => {
            this.logger.debug("Unexpected error - process old downloaded block", {}, e);
          });
        }
      }

      this.logger.verbose("No unknown block, process ancestor downloaded blocks", {
        pendingBlocks: this.pendingBlocks.size,
        ancestorBlocks: ancestors.length,
        processedBlocks,
      });
      return;
    }

    // most of the time there is exactly 1 unknown block
    for (const block of unknowns) {
      this.downloadBlock(block, connectedPeers).catch((e) => {
        this.logger.debug("Unexpected error - downloadBlock", {root: block.blockRootHex}, e);
      });
    }
  };

  private async downloadBlock(block: PendingBlock, connectedPeers: PeerIdStr[]): Promise<void> {
    if (block.status !== PendingBlockStatus.pending) {
      return;
    }

    const unknownBlockType = block.unknownBlockType;

    this.logger.verbose("Downloading unknown block", {
      root: block.blockRootHex,
      pendingBlocks: this.pendingBlocks.size,
      slot: block.blockInput?.block?.message.slot ?? "unknown",
      unknownBlockType,
    });

    block.status = PendingBlockStatus.fetching;

    let res;
    if (block.blockInput === null) {
      res = await wrapError(this.fetchUnknownBlockRoot(fromHex(block.blockRootHex), connectedPeers));
    } else {
      res = await wrapError(this.fetchUnavailableBlockInput(block.blockInput, connectedPeers));
    }

    if (res.err) this.metrics?.syncUnknownBlock.downloadedBlocksError.inc();
    else this.metrics?.syncUnknownBlock.downloadedBlocksSuccess.inc();

    if (!res.err) {
      const {blockInput, peerIdStr} = res.result;
      block = {
        ...block,
        status: PendingBlockStatus.downloaded,
        blockInput,
        parentBlockRootHex: toRootHex(blockInput.block.message.parentRoot),
      };
      this.pendingBlocks.set(block.blockRootHex, block);
      const blockSlot = blockInput.block.message.slot;
      const finalizedSlot = this.chain.forkChoice.getFinalizedBlock().slot;
      const delaySec = Date.now() / 1000 - (this.chain.genesisTime + blockSlot * this.config.SECONDS_PER_SLOT);
      this.metrics?.syncUnknownBlock.elapsedTimeTillReceived.observe(delaySec);

      const parentInForkchoice = this.chain.forkChoice.hasBlock(blockInput.block.message.parentRoot);
      this.logger.verbose("Downloaded unknown block", {
        root: block.blockRootHex,
        pendingBlocks: this.pendingBlocks.size,
        parentInForkchoice,
        blockInputType: blockInput.type,
        unknownBlockType,
      });

      if (parentInForkchoice) {
        // Bingo! Process block. Add to pending blocks anyway for recycle the cache that prevents duplicate processing
        this.processBlock(block).catch((e) => {
          this.logger.debug("Unexpected error - process newly downloaded block", {}, e);
        });
      } else if (blockSlot <= finalizedSlot) {
        // the common ancestor of the downloading chain and canonical chain should be at least the finalized slot and
        // we should found it through forkchoice. If not, we should penalize all peers sending us this block chain
        // 0 - 1 - ... - n - finalizedSlot
        //                \
        //                parent 1 - parent 2 - ... - unknownParent block
        const blockRoot = this.config.getForkTypes(blockSlot).BeaconBlock.hashTreeRoot(blockInput.block.message);
        this.logger.debug("Downloaded block is before finalized slot", {
          finalizedSlot,
          blockSlot,
          parentRoot: toRootHex(blockRoot),
          unknownBlockType,
        });
        this.removeAndDownscoreAllDescendants(block);
      } else {
        this.onUnknownParent({blockInput, peer: peerIdStr});
      }
    } else {
      // this allows to retry the download of the block
      block.status = PendingBlockStatus.pending;
      // parentSlot > finalizedSlot, continue downloading parent of parent
      block.downloadAttempts++;
      const errorData = {root: block.blockRootHex, attempts: block.downloadAttempts, unknownBlockType};
      if (block.downloadAttempts > MAX_ATTEMPTS_PER_BLOCK) {
        // Give up on this block and assume it does not exist, penalizing all peers as if it was a bad block
        this.logger.debug("Ignoring unknown block root after many failed downloads", errorData, res.err);
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
    if (pendingBlock.status !== PendingBlockStatus.downloaded) {
      return;
    }

    pendingBlock.status = PendingBlockStatus.processing;
    // this prevents unbundling attack
    // see https://lighthouse-blog.sigmaprime.io/mev-unbundling-rpc.html
    const {slot: blockSlot, proposerIndex} = pendingBlock.blockInput.block.message;
    if (
      this.chain.clock.secFromSlot(blockSlot) < this.proposerBoostSecWindow &&
      this.chain.seenBlockProposers.isKnown(blockSlot, proposerIndex)
    ) {
      // proposer is known by a gossip block already, wait a bit to make sure this block is not
      // eligible for proposer boost to prevent unbundling attack
      const blockRoot = this.config
        .getForkTypes(blockSlot)
        .BeaconBlock.hashTreeRoot(pendingBlock.blockInput.block.message);
      this.logger.verbose("Avoid proposer boost for this block of known proposer", {
        blockSlot,
        blockRoot: toRootHex(blockRoot),
        proposerIndex,
      });
      await sleep(this.proposerBoostSecWindow * 1000);
    }
    // At gossip time, it's critical to keep a good number of mesh peers.
    // To do that, the Gossip Job Wait Time should be consistently <3s to avoid the behavior penalties in gossip
    // Gossip Job Wait Time depends on the BLS Job Wait Time
    // so `blsVerifyOnMainThread = true`: we want to verify signatures immediately without affecting the bls thread pool.
    // otherwise we can't utilize bls thread pool capacity and Gossip Job Wait Time can't be kept low consistently.
    // See https://github.com/ChainSafe/lodestar/issues/3792
    const res = await wrapError(
      this.chain.processBlock(pendingBlock.blockInput, {
        ignoreIfKnown: true,
        // there could be finalized/head sync at the same time so we need to ignore if finalized
        // see https://github.com/ChainSafe/lodestar/issues/5650
        ignoreIfFinalized: true,
        blsVerifyOnMainThread: true,
        // block is validated with correct root, we want to process it as soon as possible
        eagerPersistBlock: true,
      })
    );

    if (res.err) this.metrics?.syncUnknownBlock.processedBlocksError.inc();
    else this.metrics?.syncUnknownBlock.processedBlocksSuccess.inc();

    if (!res.err) {
      // no need to update status to "processed", delete anyway
      this.pendingBlocks.delete(pendingBlock.blockRootHex);

      // Send child blocks to the processor
      for (const descendantBlock of getDescendantBlocks(pendingBlock.blockRootHex, this.pendingBlocks)) {
        this.processBlock(descendantBlock).catch((e) => {
          this.logger.debug("Unexpected error - process descendant block", {}, e);
        });
      }
    } else {
      const errorData = {root: pendingBlock.blockRootHex, slot: pendingBlock.blockInput.block.message.slot};
      if (res.err instanceof BlockError) {
        switch (res.err.type.code) {
          // This cases are already handled with `{ignoreIfKnown: true}`
          // case BlockErrorCode.ALREADY_KNOWN:
          // case BlockErrorCode.GENESIS_BLOCK:

          case BlockErrorCode.PARENT_UNKNOWN:
          case BlockErrorCode.PRESTATE_MISSING:
            // Should not happen, mark as downloaded to try again latter
            this.logger.debug("Attempted to process block but its parent was still unknown", errorData, res.err);
            pendingBlock.status = PendingBlockStatus.downloaded;
            break;

          case BlockErrorCode.EXECUTION_ENGINE_ERROR:
            // Removing the block(s) without penalizing the peers, hoping for EL to
            // recover on a latter download + verify attempt
            this.removeAllDescendants(pendingBlock);
            break;

          default:
            // Block is not correct with respect to our chain. Log error loudly
            this.logger.debug("Error processing block from unknown parent sync", errorData, res.err);
            this.removeAndDownscoreAllDescendants(pendingBlock);
        }
      }

      // Probably a queue error or something unwanted happened, mark as pending to try again latter
      else {
        this.logger.debug("Unknown error processing block from unknown block sync", errorData, res.err);
        pendingBlock.status = PendingBlockStatus.downloaded;
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
    connectedPeers: PeerIdStr[]
  ): Promise<{blockInput: BlockInput; peerIdStr: string}> {
    const shuffledPeers = shuffle(connectedPeers);
    const blockRootHex = toRootHex(blockRoot);

    let lastError: Error | null = null;
    for (let i = 0; i < MAX_ATTEMPTS_PER_BLOCK; i++) {
      const peer = shuffledPeers[i % shuffledPeers.length];
      try {
        const [blockInput] = await beaconBlocksMaybeBlobsByRoot(this.config, this.network, peer, [blockRoot]);

        // Peer does not have the block, try with next peer
        if (blockInput === undefined) {
          continue;
        }

        // Verify block root is correct
        const block = blockInput.block.message;
        const receivedBlockRoot = this.config.getForkTypes(block.slot).BeaconBlock.hashTreeRoot(block);
        if (!byteArrayEquals(receivedBlockRoot, blockRoot)) {
          throw Error(`Wrong block received by peer, got ${toRootHex(receivedBlockRoot)} expected ${blockRootHex}`);
        }

        return {blockInput, peerIdStr: peer};
      } catch (e) {
        this.logger.debug("Error fetching UnknownBlockRoot", {attempt: i, blockRootHex, peer}, e as Error);
        lastError = e as Error;
      }
    }

    if (lastError) {
      lastError.message = `Error fetching UnknownBlockRoot after ${MAX_ATTEMPTS_PER_BLOCK} attempts: ${lastError.message}`;
      throw lastError;
    }
    throw Error(`Error fetching UnknownBlockRoot after ${MAX_ATTEMPTS_PER_BLOCK}: unknown error`);
  }

  /**
   * Fetches missing blobs for the blockinput, in future can also pull block is thats also missing
   * along with the blobs (i.e. only some blobs are available)
   */
  private async fetchUnavailableBlockInput(
    unavailableBlockInput: BlockInput | NullBlockInput,
    connectedPeers: PeerIdStr[]
  ): Promise<{blockInput: BlockInput; peerIdStr: string}> {
    if (unavailableBlockInput.block !== null && unavailableBlockInput.type !== BlockInputType.dataPromise) {
      return {blockInput: unavailableBlockInput, peerIdStr: ""};
    }

    const shuffledPeers = shuffle(connectedPeers);
    let blockRootHex;
    let pendingBlobs;
    let blobKzgCommitmentsLen;
    let blockRoot;

    if (unavailableBlockInput.block === null) {
      blockRootHex = unavailableBlockInput.blockRootHex;
      blockRoot = fromHex(blockRootHex);
    } else {
      const unavailableBlock = unavailableBlockInput.block;
      blockRoot = this.config
        .getForkTypes(unavailableBlock.message.slot)
        .BeaconBlock.hashTreeRoot(unavailableBlock.message);
      blockRootHex = toRootHex(blockRoot);
      blobKzgCommitmentsLen = (unavailableBlock.message.body as deneb.BeaconBlockBody).blobKzgCommitments.length;
      pendingBlobs = blobKzgCommitmentsLen - unavailableBlockInput.cachedData.blobsCache.size;
    }

    let lastError: Error | null = null;
    for (let i = 0; i < MAX_ATTEMPTS_PER_BLOCK; i++) {
      const peer = shuffledPeers[i % shuffledPeers.length];
      try {
        const blockInput = await unavailableBeaconBlobsByRoot(
          this.config,
          this.network,
          peer,
          unavailableBlockInput,
          this.metrics
        );

        // Peer does not have the block, try with next peer
        if (blockInput === undefined) {
          continue;
        }

        // Verify block root is correct
        const block = blockInput.block.message;
        const receivedBlockRoot = this.config.getForkTypes(block.slot).BeaconBlock.hashTreeRoot(block);

        if (!byteArrayEquals(receivedBlockRoot, blockRoot)) {
          throw Error(`Wrong block received by peer, got ${toRootHex(receivedBlockRoot)} expected ${blockRootHex}`);
        }
        if (unavailableBlockInput.block === null) {
          this.logger.debug("Fetched  NullBlockInput", {attempts: i, blockRootHex});
        } else {
          this.logger.debug("Fetched UnavailableBlockInput", {attempts: i, pendingBlobs, blobKzgCommitmentsLen});
        }

        return {blockInput, peerIdStr: peer};
      } catch (e) {
        this.logger.debug("Error fetching UnavailableBlockInput", {attempt: i, blockRootHex, peer}, e as Error);
        lastError = e as Error;
      }
    }

    if (lastError) {
      lastError.message = `Error fetching UnavailableBlockInput after ${MAX_ATTEMPTS_PER_BLOCK} attempts: ${lastError.message}`;
      throw lastError;
    }

    throw Error(`Error fetching UnavailableBlockInput after ${MAX_ATTEMPTS_PER_BLOCK}: unknown error`);
  }

  /**
   * Gets all descendant blocks of `block` recursively from `pendingBlocks`.
   * Assumes that if a parent block does not exist or is not processable, all descendant blocks are bad too.
   * Downscore all peers that have referenced any of this bad blocks. May report peers multiple times if they have
   * referenced more than one bad block.
   */
  private removeAndDownscoreAllDescendants(block: PendingBlock): void {
    // Get all blocks that are a descendant of this one
    const badPendingBlocks = this.removeAllDescendants(block);

    for (const block of badPendingBlocks) {
      this.knownBadBlocks.add(block.blockRootHex);
      for (const peerIdStr of block.peerIdStrs) {
        // TODO: Refactor peerRpcScores to work with peerIdStr only
        this.network.reportPeer(peerIdStr, PeerAction.LowToleranceError, "BadBlockByRoot");
      }
      this.logger.debug("Banning unknown block", {
        root: block.blockRootHex,
        peerIdStrs: Array.from(block.peerIdStrs).join(","),
      });
    }

    // Prune knownBadBlocks
    pruneSetToMax(this.knownBadBlocks, MAX_KNOWN_BAD_BLOCKS);
  }

  private removeAllDescendants(block: PendingBlock): PendingBlock[] {
    // Get all blocks that are a descendant of this one
    const badPendingBlocks = [block, ...getAllDescendantBlocks(block.blockRootHex, this.pendingBlocks)];

    this.metrics?.syncUnknownBlock.removedBlocks.inc(badPendingBlocks.length);

    for (const block of badPendingBlocks) {
      this.pendingBlocks.delete(block.blockRootHex);
      this.logger.debug("Removing unknown parent block", {
        root: block.blockRootHex,
      });
    }

    return badPendingBlocks;
  }
}
