import {ChainForkConfig} from "@lodestar/config";
import {ForkName, ForkSeq, INTERVALS_PER_SLOT} from "@lodestar/params";
import {ColumnIndex, Root, RootHex, deneb} from "@lodestar/types";
import {BlobAndProof} from "@lodestar/types/deneb";
import {Logger, fromHex, prettyBytes, pruneSetToMax, toRootHex} from "@lodestar/utils";
import {sleep} from "@lodestar/utils";
import {isBlockInputColumns} from "../chain/blocks/blockInput/blockInput.js";
import {BlockInputSource, IBlockInput} from "../chain/blocks/blockInput/types.js";
import {BlockError, BlockErrorCode} from "../chain/errors/index.js";
import {ChainEvent, ChainEventData, IBeaconChain} from "../chain/index.js";
import {Metrics} from "../metrics/index.js";
import {INetwork, NetworkEvent, NetworkEventData} from "../network/index.js";
import {PeerSyncMeta} from "../network/peers/peersData.js";
import {byteArrayEquals} from "../util/bytes.js";
import {CustodyConfig} from "../util/dataColumns.js";
import {PeerIdStr} from "../util/peerId.js";
import {shuffle} from "../util/shuffle.js";
import {sortBy} from "../util/sortBy.js";
import {Result, wrapError} from "../util/wrapError.js";
import {MAX_CONCURRENT_REQUESTS} from "./constants.js";
import {SyncOptions} from "./options.js";
import {
  BlockInputSyncCacheItem,
  PendingBlockInput,
  PendingBlockInputStatus,
  PendingBlockType,
  PendingRootHex,
  getBlockInputSyncCacheItemRootHex,
  isPendingBlockInput,
} from "./types.js";
import {
  getAllDescendantBlocks,
  getDescendantBlocks,
  getIncompleteAndAncestorBlocks,
} from "./utils/pendingBlocksTree.js";

const MAX_ATTEMPTS_PER_BLOCK = 5;
const MAX_KNOWN_BAD_BLOCKS = 500;
const MAX_PENDING_BLOCKS = 100;

function getLogMeta(
  block: BlockInputSyncCacheItem,
  pendingBlocks?: Map<RootHex, BlockInputSyncCacheItem>
): Record<string, string | number> {
  const pendingBlocksLog: Record<string, number> = pendingBlocks ? {pendingBlocks: pendingBlocks.size} : {};
  return isPendingBlockInput(block)
    ? {
        type: "pendingBlockInput",
        ...pendingBlocksLog,
        ...block.blockInput.getLogMeta(),
      }
    : {
        type: "pendingRootHex",
        ...pendingBlocksLog,
        rootHex: prettyBytes(block.rootHex),
      };
}

/**
 * BlockInputSync is a class that handles ReqResp to find blocks and data related to a specific blockRoot.  The
 * blockRoot may have been found via object gossip, or the API.  Gossip objects that can trigger a search are block,
 * blobs, columns, attestations, etc.  In the case of blocks and data this is generally during the current slot but
 * can also be for items that are received late but are not fully verified and thus not in fork-choice (old blocks on
 * an unknown fork). It can also be triggered via an attestation (or sync committee message or any other item that
 * gets gossiped) that references a blockRoot that is not in fork-choice.  In rare (and realistically should not happen)
 * situations it can get triggered via the API when the validator attempts to publish a block, attestation, aggregate
 * and proof or a sync committee contribution that has unknown information included (parentRoot for instance).
 *
 * The goal of the class is to make sure that all information that is necessary for import into fork-choice is pulled
 * from peers so that the block and data can be processed, and thus the object that triggered the search can be
 * referenced and validated.
 *
 * The most common case for this search is a set of block/data that comes across gossip for the current slot, during
 * normal chain operation, but not everything was received before the gossip cutoff window happens so it is necessary
 * to pull remaining data via req/resp so that fork-choice can be updated prior to making an attestation for the
 * current slot.
 *
 * Event sources for old UnknownBlock
 *
 * - publishBlock
 * - gossipHandlers
 * - searchUnknownSlotRoot
 *    = produceSyncCommitteeContribution
 *    = validateGossipFnRetryUnknownRoot
 *        * submitPoolAttestationsV2
 *        * publishAggregateAndProofsV2
 *    = onPendingGossipsubMessage
 *        * NetworkEvent.pendingGossipsubMessage
 *            - onGossipsubMessage
 */
export class BlockInputSync {
  /**
   * block RootHex -> PendingBlock. To avoid finding same root at the same time
   */
  private readonly pendingBlocks = new Map<RootHex, BlockInputSyncCacheItem>();
  private readonly knownBadBlocks = new Set<RootHex>();
  private readonly proposerBoostSecWindow: number;
  private readonly maxPendingBlocks;
  private subscribedToNetworkEvents = false;
  private peerBalancer: UnknownBlockPeerBalancer;

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
    this.peerBalancer = new UnknownBlockPeerBalancer(this.network.custodyConfig);

    if (metrics) {
      metrics.blockInputSync.pendingBlocks.addCollect(() =>
        metrics.blockInputSync.pendingBlocks.set(this.pendingBlocks.size)
      );
      metrics.blockInputSync.knownBadBlocks.addCollect(() =>
        metrics.blockInputSync.knownBadBlocks.set(this.knownBadBlocks.size)
      );
    }
  }

  subscribeToNetwork(): void {
    if (this.opts?.disableBlockInputSync) {
      this.logger.verbose("BlockInputSync disabled by disableBlockInputSync option.");
      return;
    }

    // cannot chain to the above if or the log will be incorrect
    if (!this.subscribedToNetworkEvents) {
      this.logger.verbose("BlockInputSync enabled.");
      this.chain.emitter.on(ChainEvent.unknownBlockRoot, this.onUnknownBlockRoot);
      this.chain.emitter.on(ChainEvent.incompleteBlockInput, this.onIncompleteBlockInput);
      this.chain.emitter.on(ChainEvent.unknownParent, this.onUnknownParent);
      this.network.events.on(NetworkEvent.peerConnected, this.onPeerConnected);
      this.network.events.on(NetworkEvent.peerDisconnected, this.onPeerDisconnected);
      this.subscribedToNetworkEvents = true;
    }
  }

  unsubscribeFromNetwork(): void {
    this.logger.verbose("BlockInputSync disabled.");
    this.chain.emitter.off(ChainEvent.unknownBlockRoot, this.onUnknownBlockRoot);
    this.chain.emitter.off(ChainEvent.incompleteBlockInput, this.onIncompleteBlockInput);
    this.chain.emitter.off(ChainEvent.unknownParent, this.onUnknownParent);
    this.network.events.off(NetworkEvent.peerConnected, this.onPeerConnected);
    this.network.events.off(NetworkEvent.peerDisconnected, this.onPeerDisconnected);
    this.subscribedToNetworkEvents = false;
  }

  close(): void {
    this.unsubscribeFromNetwork();
  }

  isSubscribedToNetwork(): boolean {
    return this.subscribedToNetworkEvents;
  }

  /**
   * Process an unknownBlock event and register the block in `pendingBlocks` Map.
   */
  private onUnknownBlockRoot = (data: ChainEventData[ChainEvent.unknownBlockRoot]): void => {
    try {
      this.addByRootHex(data.rootHex, data.peer);
      this.triggerUnknownBlockSearch();
      this.metrics?.blockInputSync.requests.inc({type: PendingBlockType.UNKNOWN_BLOCK_ROOT});
      this.metrics?.blockInputSync.source.inc({source: data.source});
    } catch (e) {
      this.logger.debug("Error handling unknownBlockRoot event", {}, e as Error);
    }
  };

  /**
   * Process an unknownBlockInput event and register the block in `pendingBlocks` Map.
   */
  private onIncompleteBlockInput = (data: ChainEventData[ChainEvent.incompleteBlockInput]): void => {
    try {
      this.addByBlockInput(data.blockInput, data.peer);
      this.triggerUnknownBlockSearch();
      this.metrics?.blockInputSync.requests.inc({type: PendingBlockType.INCOMPLETE_BLOCK_INPUT});
      this.metrics?.blockInputSync.source.inc({source: data.source});
    } catch (e) {
      this.logger.debug("Error handling incompleteBlockInput event", {}, e as Error);
    }
  };

  /**
   * Process an unknownBlockParent event and register the block in `pendingBlocks` Map.
   */
  private onUnknownParent = (data: ChainEventData[ChainEvent.unknownParent]): void => {
    try {
      this.addByRootHex(data.blockInput.parentRootHex, data.peer);
      this.addByBlockInput(data.blockInput, data.peer);
      this.triggerUnknownBlockSearch();
      this.metrics?.blockInputSync.requests.inc({type: PendingBlockType.UNKNOWN_PARENT});
      this.metrics?.blockInputSync.source.inc({source: data.source});
    } catch (e) {
      this.logger.debug("Error handling unknownParent event", {}, e as Error);
    }
  };

  private addByRootHex = (rootHex: RootHex, peerIdStr?: PeerIdStr): void => {
    let pendingBlock = this.pendingBlocks.get(rootHex) as PendingRootHex;
    if (!pendingBlock) {
      pendingBlock = {
        status: PendingBlockInputStatus.pending,
        rootHex: rootHex,
        peerIdStrings: new Set(),
        timeAddedSec: Date.now() / 1000,
      };
      this.pendingBlocks.set(rootHex, pendingBlock);

      this.logger.verbose("Added new rootHex to BlockInputSync.pendingBlocks", {
        rootHex: prettyBytes(pendingBlock.rootHex),
        peerIdStr: peerIdStr ?? "unknown peer",
      });
    }

    if (peerIdStr) {
      pendingBlock.peerIdStrings.add(peerIdStr);
    }

    // TODO: check this prune methodology
    // Limit pending blocks to prevent DOS attacks that cause OOM
    const prunedItemCount = pruneSetToMax(this.pendingBlocks, this.maxPendingBlocks);
    if (prunedItemCount > 0) {
      this.logger.verbose(`Pruned ${prunedItemCount} items from BlockInputSync.pendingBlocks`);
    }
  };

  private addByBlockInput = (blockInput: IBlockInput, peerIdStr?: string): void => {
    let pendingBlock = this.pendingBlocks.get(blockInput.blockRootHex) as PendingBlockInput;
    // if entry is missing or was added via rootHex and now we have more complete information overwrite
    // the existing information with the more complete cache entry
    if (!pendingBlock || !isPendingBlockInput(pendingBlock)) {
      pendingBlock = {
        // can be added via unknown parent and we may already have full block input. need to check and set correctly
        // so we pull the data if its missing or handle the block correctly in getIncompleteAndAncestorBlocks
        status: blockInput.hasBlockAndAllData() ? PendingBlockInputStatus.downloaded : PendingBlockInputStatus.pending,
        blockInput,
        peerIdStrings: new Set(),
        timeAddedSec: Date.now() / 1000,
      };
      this.pendingBlocks.set(blockInput.blockRootHex, pendingBlock);

      this.logger.verbose("Added blockInput to BlockInputSync.pendingBlocks", pendingBlock.blockInput.getLogMeta());
    }

    if (peerIdStr) {
      pendingBlock.peerIdStrings.add(peerIdStr);
    }

    // TODO: check this prune methodology
    // Limit pending blocks to prevent DOS attacks that cause OOM
    const prunedItemCount = pruneSetToMax(this.pendingBlocks, this.maxPendingBlocks);
    if (prunedItemCount > 0) {
      this.logger.verbose(`Pruned ${prunedItemCount} items from BlockInputSync.pendingBlocks`);
    }
  };

  private onPeerConnected = (data: NetworkEventData[NetworkEvent.peerConnected]): void => {
    try {
      const peerId = data.peer;
      const peerSyncMeta = this.network.getConnectedPeerSyncMeta(peerId);
      this.peerBalancer.onPeerConnected(data.peer, peerSyncMeta);
      this.triggerUnknownBlockSearch();
    } catch (e) {
      this.logger.debug("Error handling peerConnected event", {}, e as Error);
    }
  };

  private onPeerDisconnected = (data: NetworkEventData[NetworkEvent.peerDisconnected]): void => {
    const peerId = data.peer;
    this.peerBalancer.onPeerDisconnected(peerId);
  };

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

    const {incomplete, ancestors} = getIncompleteAndAncestorBlocks(this.pendingBlocks);
    // it's rare when there is no unknown block
    // see https://github.com/ChainSafe/lodestar/issues/5649#issuecomment-1594213550
    if (incomplete.length === 0) {
      let processedBlocks = 0;

      for (const block of ancestors) {
        // when this happens, it's likely the block and parent block are processed by head sync
        if (this.chain.forkChoice.hasBlockHex(block.blockInput.parentRootHex)) {
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
    for (const block of incomplete) {
      this.downloadBlock(block).catch((e) => {
        this.logger.debug("Unexpected error - downloadBlock", {root: getBlockInputSyncCacheItemRootHex(block)}, e);
      });
    }
  };

  private async downloadBlock(block: PendingBlock): Promise<void> {
    if (block.status !== PendingBlockStatus.pending) {
      return;
    }

    const unknownBlockType = block.unknownBlockType;
    const logCtx = {
      root: block.blockRootHex,
      pendingBlocks: this.pendingBlocks.size,
      slot: block.blockInput?.block?.message.slot ?? "unknown",
      unknownBlockType,
    };

    this.logger.verbose("Downloading unknown block", logCtx);

    block.status = PendingBlockStatus.fetching;

    let res: Result<{blockInput: BlockInput; peerIdStr: string}>;
    if (block.blockInput === null) {
      // we only have block root, and nothing else
      res = await wrapError(this.fetchUnknownBlockRoot(fromHex(block.blockRootHex)));
    } else {
      res = await wrapError(this.fetchUnavailableBlockInput(block.blockInput));
    }

    if (res.err) this.metrics?.syncUnknownBlock.downloadedBlocksError.inc();
    else this.metrics?.syncUnknownBlock.downloadedBlocksSuccess.inc();

    if (!res.err) {
      const {blockInput, peerIdStr} = res.result;
      // fetchUnknownBlockRoot and fetchUnavailableBlockInput should return available data BlockInput, throw error if not
      if (blockInput.type === BlockInputType.dataPromise) {
        // if there were any peers who would have had the missing datacolumns, it would have resulted in err
        throw Error(`Expected BlockInput to be available, got dataPromise for ${block.blockRootHex}`);
      }

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
      // block download has error, this allows to retry the download of the block
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
   * This function could run recursively for all descendant blocks
   */
  private async processBlock(pendingBlock: PendingBlock): Promise<void> {
    // pending block status is `downloaded` right after `downloadBlock`
    // but could be `pending` if added by `onUnknownBlockParent` event and this function is called recursively
    if (pendingBlock.status !== PendingBlockStatus.downloaded) {
      if (pendingBlock.status === PendingBlockStatus.pending) {
        const connectedPeers = this.network.getConnectedPeers();
        if (connectedPeers.length === 0) {
          this.logger.debug("No connected peers, skipping download block", {blockRoot: pendingBlock.blockRootHex});
          return;
        }
        // if the download is a success we'll call `processBlock()` for this block
        await this.downloadBlock(pendingBlock);
      }
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
   * From a set of shuffled peers:
   *   - fetch the block
   *   - from deneb, fetch all missing blobs
   *   - from peerDAS, fetch sampled colmns
   * TODO: this means we only have block root, and nothing else. Consider to reflect this in the function name
   * prefulu, will attempt a max of `MAX_ATTEMPTS_PER_BLOCK` on different peers, postfulu we may attempt more as defined in `getMaxDownloadAttempts()` function
   * Also verifies the received block root + returns the peer that provided the block for future downscoring.
   */
  private async fetchUnknownBlockRoot(blockRoot: Root): Promise<{blockInput: BlockInput; peerIdStr: string}> {
    const blockRootHex = toRootHex(blockRoot);

    const excludedPeers = new Set<PeerIdStr>();
    let partialDownload: PartialDownload | null = null;
    const defaultPendingColumns =
      this.config.getForkSeq(this.chain.clock.currentSlot) >= ForkSeq.fulu
        ? new Set(this.network.custodyConfig.sampleGroups)
        : null;
    let lastError: Error | null = null;
    let i = 0;
    while (i++ < this.getMaxDownloadAttempts()) {
      // pendingDataColumns is null prefulu
      const peer = this.peerBalancer.bestPeerForPendingColumns(
        partialDownload ? new Set(partialDownload.pendingDataColumns) : defaultPendingColumns,
        excludedPeers
      );
      if (peer === null) {
        // no more peer with needed columns to try, throw error
        throw Error(
          `Error fetching UnknownBlockRoot after ${i}: cannot find peer with needed columns ${partialDownload?.pendingDataColumns.join(", ")}`
        );
      }
      const {peerId, client: peerClient} = peer;
      excludedPeers.add(peerId);

      try {
        const {
          blocks: [blockInput],
          pendingDataColumns,
        } = await beaconBlocksMaybeBlobsByRoot(
          this.config,
          this.network,
          peerId,
          [blockRoot],
          partialDownload,
          peerClient,
          this.metrics,
          this.logger
        );

        // Peer does not have the block, try with next peer
        if (blockInput === undefined) {
          continue;
        }

        if (pendingDataColumns !== null) {
          partialDownload = {blocks: [blockInput], pendingDataColumns};
          continue;
        }

        // data is available, verify block root is correct
        const block = blockInput.block.message;
        const receivedBlockRoot = this.config.getForkTypes(block.slot).BeaconBlock.hashTreeRoot(block);
        if (!byteArrayEquals(receivedBlockRoot, blockRoot)) {
          throw Error(`Wrong block received by peer, got ${toRootHex(receivedBlockRoot)} expected ${blockRootHex}`);
        }

        return {blockInput, peerIdStr: peerId};
      } catch (e) {
        this.logger.debug("Error fetching UnknownBlockRoot", {attempt: i, blockRootHex, peer: peerId}, e as Error);
        lastError = e as Error;
      } finally {
        this.peerBalancer.onRequestCompleted(peerId);
      }
    }

    if (lastError) {
      lastError.message = `Error fetching UnknownBlockRoot after ${i} attempts: ${lastError.message}`;
      throw lastError;
    }

    throw Error(
      `Error fetching UnknownBlockRoot after ${i}: cannot download all blobs or data columns for block ${blockRootHex}`
    );
  }

  /**
   * We have partial block input:
   * - we have block but not have all blobs (deneb) or needed columns (fulu)
   * - we don't have block and have some blobs (deneb) or some columns (fulu)
   * Fetches missing block/data columns/block for the blockinput. This function returns either preData or availableData BlockInput.
   */
  private async fetchUnavailableBlockInput(
    unavailableBlockInput: BlockInput | NullBlockInput
  ): Promise<{blockInput: BlockInput; peerIdStr: string}> {
    if (unavailableBlockInput.block !== null && unavailableBlockInput.type !== BlockInputType.dataPromise) {
      return {blockInput: unavailableBlockInput, peerIdStr: ""};
    }

    let blockRootHex: RootHex;
    let blobKzgCommitmentsLen: number | undefined;
    let blockRoot: Uint8Array;
    const dataMeta: Record<string, unknown> = {};
    let sampledColumns: ColumnIndex[] = [];

    if (unavailableBlockInput.block === null) {
      blockRootHex = unavailableBlockInput.blockRootHex;
      blockRoot = fromHex(blockRootHex);
    } else {
      const {cachedData, block: unavailableBlock} = unavailableBlockInput;
      blockRoot = this.config
        .getForkTypes(unavailableBlock.message.slot)
        .BeaconBlock.hashTreeRoot(unavailableBlock.message);
      blockRootHex = toRootHex(blockRoot);
      blobKzgCommitmentsLen = (unavailableBlock.message.body as deneb.BeaconBlockBody).blobKzgCommitments.length;

      if (cachedData.fork === ForkName.deneb || cachedData.fork === ForkName.electra) {
        const pendingBlobs = blobKzgCommitmentsLen - cachedData.blobsCache.size;
        Object.assign(dataMeta, {pendingBlobs});
      } else if (cachedData.fork === ForkName.fulu) {
        sampledColumns = this.network.custodyConfig.sampledColumns;
        const pendingColumns = sampledColumns.length - (cachedData as CachedDataColumns).dataColumnsCache.size;
        Object.assign(dataMeta, {pendingColumns});
      }
    }

    let lastError: Error | null = null;
    let i = 0;
    const excludedPeers = new Set<PeerIdStr>();
    while (i++ < this.getMaxDownloadAttempts()) {
      const bestPeer = this.peerBalancer.bestPeerForBlockInput(unavailableBlockInput, excludedPeers);
      if (bestPeer === null) {
        // no more peer to try, throw error
        throw Error(
          `Error fetching UnavailableBlockInput after ${i}: cannot find peer with needed columns ${sampledColumns.join(", ")}`
        );
      }
      const {peerId, client: peerClient} = bestPeer;
      excludedPeers.add(peerId);

      try {
        const blockInput = await unavailableBeaconBlobsByRoot(
          this.config,
          this.network,
          peerId,
          peerClient,
          unavailableBlockInput,
          {
            metrics: this.metrics,
            logger: this.logger,
            executionEngine: this.chain.executionEngine,
            emitter: this.chain.emitter,
            blockInputsRetryTrackerCache: this.blockInputsRetryTrackerCache,
            engineGetBlobsCache: this.engineGetBlobsCache,
          }
        );

        if (unavailableBlockInput.block !== null && blockInput.type === BlockInputType.dataPromise) {
          // all datacolumns were not downloaded we can continue with other peers
          // as unavailableBlockInput.block's dataColumnsCache would be updated
          continue;
        }

        // data is available, verify block root is correct
        const block = blockInput.block.message;
        const receivedBlockRoot = this.config.getForkTypes(block.slot).BeaconBlock.hashTreeRoot(block);

        if (!byteArrayEquals(receivedBlockRoot, blockRoot)) {
          throw Error(`Wrong block received by peer, got ${toRootHex(receivedBlockRoot)} expected ${blockRootHex}`);
        }
        if (unavailableBlockInput.block === null) {
          this.logger.debug("Fetched  NullBlockInput", {attempts: i, blockRootHex});
        } else {
          this.logger.debug("Fetched UnavailableBlockInput", {attempts: i, ...dataMeta, blobKzgCommitmentsLen});
        }

        return {blockInput, peerIdStr: peerId};
      } catch (e) {
        this.logger.debug("Error fetching UnavailableBlockInput", {attempt: i, blockRootHex, peer: peerId}, e as Error);
        lastError = e as Error;
      } finally {
        this.peerBalancer.onRequestCompleted(peerId);
      }
    }

    if (lastError) {
      lastError.message = `Error fetching UnavailableBlockInput after ${i} attempts: ${lastError.message}`;
      throw lastError;
    }

    throw Error(`Error fetching UnavailableBlockInput after ${i}: unknown error`);
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
    // just console log and do not penalize on pending/bad blocks for debugging
    // console.log("removeAndDownscoreAllDescendants", {block});

    for (const block of badPendingBlocks) {
      //   this.knownBadBlocks.add(block.blockRootHex);
      //   for (const peerIdStr of block.peerIdStrs) {
      //     // TODO: Refactor peerRpcScores to work with peerIdStr only
      //     this.network.reportPeer(peerIdStr, PeerAction.LowToleranceError, "BadBlockByRoot");
      //   }
      this.logger.debug("ignored Banning unknown block", {
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

  private getMaxDownloadAttempts(): number {
    if (this.config.getForkSeq(this.chain.clock.currentSlot) < ForkSeq.fulu) {
      return MAX_ATTEMPTS_PER_BLOCK;
    }

    // TODO: I consider max 20 downloads per block for a supernode is enough for devnets
    // review this computation for public testnets or mainnet
    return Math.min(
      20,
      (MAX_ATTEMPTS_PER_BLOCK * this.network.custodyConfig.sampleGroups.length) / this.config.SAMPLES_PER_SLOT
    );
  }
}

/**
 * Class to track active byRoots requests and balance them across eligible peers.
 */
export class UnknownBlockPeerBalancer {
  readonly peersMeta: Map<PeerIdStr, PeerSyncMeta>;
  readonly activeRequests: Map<PeerIdStr, number>;
  private readonly custodyConfig: CustodyConfig;

  constructor(custodyConfig: CustodyConfig) {
    this.peersMeta = new Map();
    this.activeRequests = new Map();
    this.custodyConfig = custodyConfig;
  }

  /** Trigger on each peer re-status */
  onPeerConnected(peerId: PeerIdStr, syncMeta: PeerSyncMeta): void {
    this.peersMeta.set(peerId, syncMeta);

    if (!this.activeRequests.has(peerId)) {
      this.activeRequests.set(peerId, 0);
    }
  }

  onPeerDisconnected(peerId: PeerIdStr): void {
    this.peersMeta.delete(peerId);
    this.activeRequests.delete(peerId);
  }

  /**
   * called from fetchUnknownBlockRoot() where we only have block root and nothing else
   * excludedPeers are the peers that we requested already so we don't want to try again
   * pendingColumns is empty for prefulu, or the 1st time we we download a block by root
   */
  bestPeerForPendingColumns(pendingColumns: Set<number> | null, excludedPeers: Set<PeerIdStr>): PeerSyncMeta | null {
    const eligiblePeers = this.filterPeers(pendingColumns, excludedPeers);
    if (eligiblePeers.length === 0) {
      return null;
    }

    const sortedEligiblePeers = sortBy(
      shuffle(eligiblePeers),
      // prefer peers with least active req
      (peerId) => this.activeRequests.get(peerId) ?? 0
    );

    const bestPeerId = sortedEligiblePeers[0];
    this.onRequest(bestPeerId);
    return this.peersMeta.get(bestPeerId) ?? null;
  }

  /**
   * called from fetchUnavailableBlockInput() where we have either BlockInput or NullBlockInput
   * excludedPeers are the peers that we requested already so we don't want to try again
   */
  bestPeerForBlockInput(
    unavailableBlockInput: BlockInput | NullBlockInput,
    excludedPeers: Set<PeerIdStr>
  ): PeerSyncMeta | null {
    let cachedData: CachedData | undefined = undefined;
    if (unavailableBlockInput.block === null) {
      // NullBlockInput
      cachedData = unavailableBlockInput.cachedData;
    } else {
      // BlockInput
      if (unavailableBlockInput.type !== BlockInputType.dataPromise) {
        throw Error(
          `bestPeerForBlockInput called with BlockInput type ${unavailableBlockInput.type}, expected dataPromise`
        );
      }
      cachedData = unavailableBlockInput.cachedData;
    }

    const eligiblePeers: PeerIdStr[] = [];

    if (cachedData.fork === ForkName.fulu) {
      // cached data is CachedDataColumns
      const {dataColumnsCache} = cachedData;
      const pendingDataColumns: Set<number> = new Set();
      for (const column of this.custodyConfig.sampledColumns) {
        if (!dataColumnsCache.has(column)) {
          pendingDataColumns.add(column);
        }
      }
      if (pendingDataColumns.size === 0) {
        // no pending columns, we can return null
        return null;
      }
      eligiblePeers.push(...this.filterPeers(pendingDataColumns, excludedPeers));
    } else {
      // prefulu
      const pendingDataColumns = null;
      eligiblePeers.push(...this.filterPeers(pendingDataColumns, excludedPeers));
    }

    if (eligiblePeers.length === 0) {
      return null;
    }

    const sortedEligiblePeers = sortBy(
      shuffle(eligiblePeers),
      // prefer peers with least active req
      (peerId) => this.activeRequests.get(peerId) ?? 0
    );

    const bestPeerId = sortedEligiblePeers[0];
    this.onRequest(bestPeerId);
    return this.peersMeta.get(bestPeerId) ?? null;
  }

  /**
   * Consumers don't need to call this method directly, it is called internally by bestPeer*() methods
   * make this public for testing
   */
  onRequest(peerId: PeerIdStr): void {
    this.activeRequests.set(peerId, (this.activeRequests.get(peerId) ?? 0) + 1);
  }

  /**
   * Consumers should call this method when a request is completed for a peer.
   */
  onRequestCompleted(peerId: PeerIdStr): void {
    this.activeRequests.set(peerId, Math.max(0, (this.activeRequests.get(peerId) ?? 1) - 1));
  }

  getTotalActiveRequests(): number {
    let totalActiveRequests = 0;
    for (const count of this.activeRequests.values()) {
      totalActiveRequests += count;
    }
    return totalActiveRequests;
  }

  // pendingDataColumns could be null for prefulu
  private filterPeers(pendingDataColumns: Set<number> | null, excludedPeers: Set<PeerIdStr>): PeerIdStr[] {
    let maxColumnCount = 0;
    const considerPeers: {peerId: PeerIdStr; columnCount: number}[] = [];
    for (const [peerId, syncMeta] of this.peersMeta.entries()) {
      if (excludedPeers.has(peerId)) {
        // made request to this peer already
        continue;
      }

      const activeRequests = this.activeRequests.get(peerId) ?? 0;
      if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
        // should return peer with no more than MAX_CONCURRENT_REQUESTS active requests
        continue;
      }

      if (pendingDataColumns === null || pendingDataColumns.size === 0) {
        // prefulu, no pending columns
        considerPeers.push({peerId, columnCount: 0});
        continue;
      }

      // postfulu, find peers that have custody columns that we need
      const {custodyGroups: peerColumns} = syncMeta;
      // check if the peer has all needed columns
      // get match
      const columns = peerColumns.reduce((acc, elem) => {
        if (pendingDataColumns.has(elem)) {
          acc.push(elem);
        }
        return acc;
      }, [] as number[]);

      if (columns.length > 0) {
        if (columns.length > maxColumnCount) {
          maxColumnCount = columns.length;
        }
        considerPeers.push({peerId, columnCount: columns.length});
      }
    } // end for

    const eligiblePeers: PeerIdStr[] = [];
    for (const {peerId, columnCount} of considerPeers) {
      if (columnCount === maxColumnCount) {
        eligiblePeers.push(peerId);
      }
    }

    return eligiblePeers;
  }
}
