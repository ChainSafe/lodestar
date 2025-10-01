import {ChainForkConfig} from "@lodestar/config";
import {ForkSeq} from "@lodestar/params";
import {RequestError, RequestErrorCode} from "@lodestar/reqresp";
import {computeTimeAtSlot} from "@lodestar/state-transition";
import {RootHex} from "@lodestar/types";
import {Logger, prettyPrintIndices, pruneSetToMax, sleep} from "@lodestar/utils";
import {isBlockInputBlobs, isBlockInputColumns} from "../chain/blocks/blockInput/blockInput.js";
import {BlockInputSource, IBlockInput} from "../chain/blocks/blockInput/types.js";
import {BlockError, BlockErrorCode} from "../chain/errors/index.js";
import {ChainEvent, ChainEventData, IBeaconChain} from "../chain/index.js";
import {Metrics} from "../metrics/index.js";
import {INetwork, NetworkEvent, NetworkEventData, prettyPrintPeerIdStr} from "../network/index.js";
import {PeerSyncMeta} from "../network/peers/peersData.js";
import {PeerIdStr} from "../util/peerId.js";
import {shuffle} from "../util/shuffle.js";
import {sortBy} from "../util/sortBy.js";
import {wrapError} from "../util/wrapError.js";
import {MAX_CONCURRENT_REQUESTS} from "./constants.js";
import {SyncOptions} from "./options.js";
import {
  BlockInputSyncCacheItem,
  PendingBlockInput,
  PendingBlockInputStatus,
  PendingBlockType,
  getBlockInputSyncCacheItemRootHex,
  getBlockInputSyncCacheItemSlot,
  isPendingBlockInput,
} from "./types.js";
import {DownloadByRootError, downloadByRoot} from "./utils/downloadByRoot.js";
import {getAllDescendantBlocks, getDescendantBlocks, getUnknownAndAncestorBlocks} from "./utils/pendingBlocksTree.js";

const MAX_ATTEMPTS_PER_BLOCK = 5;
const MAX_KNOWN_BAD_BLOCKS = 500;
const MAX_PENDING_BLOCKS = 100;

enum FetchResult {
  SuccessResolved = "success_resolved",
  SuccessMissingParent = "success_missing_parent",
  SuccessLate = "success_late",
  FailureTriedAllPeers = "failure_tried_all_peers",
  FailureMaxAttempts = "failure_max_attempts",
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
    this.peerBalancer = new UnknownBlockPeerBalancer();

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
    let pendingBlock = this.pendingBlocks.get(rootHex);
    if (!pendingBlock) {
      pendingBlock = {
        status: PendingBlockInputStatus.pending,
        rootHex: rootHex,
        peerIdStrings: new Set(),
        timeAddedSec: Date.now() / 1000,
      };
      this.pendingBlocks.set(rootHex, pendingBlock);

      this.logger.verbose("Added new rootHex to BlockInputSync.pendingBlocks", {
        root: pendingBlock.rootHex,
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
    let pendingBlock = this.pendingBlocks.get(blockInput.blockRootHex);
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

    const {unknowns, ancestors} = getUnknownAndAncestorBlocks(this.pendingBlocks);
    // it's rare when there is no unknown block
    // see https://github.com/ChainSafe/lodestar/issues/5649#issuecomment-1594213550
    if (unknowns.length === 0) {
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
    for (const block of unknowns) {
      this.downloadBlock(block).catch((e) => {
        this.logger.debug("Unexpected error - downloadBlock", {root: getBlockInputSyncCacheItemRootHex(block)}, e);
      });
    }
  };

  private async downloadBlock(block: BlockInputSyncCacheItem): Promise<void> {
    if (block.status !== PendingBlockInputStatus.pending) {
      return;
    }

    const rootHex = getBlockInputSyncCacheItemRootHex(block);
    const logCtx = {
      slot: getBlockInputSyncCacheItemSlot(block),
      root: rootHex,
      pendingBlocks: this.pendingBlocks.size,
    };

    this.logger.verbose("BlockInputSync.downloadBlock()", logCtx);

    block.status = PendingBlockInputStatus.fetching;

    const res = await wrapError(this.fetchBlockInput(block));

    if (!res.err) {
      this.metrics?.blockInputSync.downloadedBlocksSuccess.inc();
      const pending = res.result;
      this.pendingBlocks.set(pending.blockInput.blockRootHex, pending);
      const blockSlot = pending.blockInput.slot;
      const finalizedSlot = this.chain.forkChoice.getFinalizedBlock().slot;
      const delaySec = Date.now() / 1000 - computeTimeAtSlot(this.config, blockSlot, this.chain.genesisTime);
      this.metrics?.blockInputSync.elapsedTimeTillReceived.observe(delaySec);

      const parentInForkChoice = this.chain.forkChoice.hasBlockHex(pending.blockInput.parentRootHex);
      const logCtx2 = {
        ...logCtx,
        slot: blockSlot,
        parentInForkChoice,
      };
      this.logger.verbose("Downloaded unknown block", logCtx2);

      if (parentInForkChoice) {
        // Bingo! Process block. Add to pending blocks anyway for recycle the cache that prevents duplicate processing
        this.processBlock(pending).catch((e) => {
          this.logger.debug("Unexpected error - process newly downloaded block", logCtx2, e);
        });
      } else if (blockSlot <= finalizedSlot) {
        // the common ancestor of the downloading chain and canonical chain should be at least the finalized slot and
        // we should found it through forkchoice. If not, we should penalize all peers sending us this block chain
        // 0 - 1 - ... - n - finalizedSlot
        //                \
        //                parent 1 - parent 2 - ... - unknownParent block
        this.logger.debug("Downloaded block is before finalized slot", {
          ...logCtx2,
          finalizedSlot,
        });
        this.removeAndDownScoreAllDescendants(block);
      } else {
        this.onUnknownBlockRoot({rootHex: pending.blockInput.parentRootHex, source: BlockInputSource.byRoot});
      }
    } else {
      this.metrics?.blockInputSync.downloadedBlocksError.inc();
      this.logger.debug("Ignoring unknown block root after many failed downloads", logCtx, res.err);
      this.removeAndDownScoreAllDescendants(block);
    }
  }

  /**
   * Send block to the processor awaiting completition. If processed successfully, send all children to the processor.
   * On error, remove and downscore all descendants.
   * This function could run recursively for all descendant blocks
   */
  private async processBlock(pendingBlock: PendingBlockInput): Promise<void> {
    // pending block status is `downloaded` right after `downloadBlock`
    // but could be `pending` if added by `onUnknownBlockParent` event and this function is called recursively
    if (pendingBlock.status !== PendingBlockInputStatus.downloaded) {
      if (pendingBlock.status === PendingBlockInputStatus.pending) {
        const connectedPeers = this.network.getConnectedPeers();
        if (connectedPeers.length === 0) {
          this.logger.debug("No connected peers, skipping download block", {
            slot: pendingBlock.blockInput.slot,
            blockRoot: pendingBlock.blockInput.blockRootHex,
          });
          return;
        }
        // if the download is a success we'll call `processBlock()` for this block
        await this.downloadBlock(pendingBlock);
      }
      return;
    }

    pendingBlock.status = PendingBlockInputStatus.processing;
    // this prevents unbundling attack
    // see https://lighthouse-blog.sigmaprime.io/mev-unbundling-rpc.html
    const {slot: blockSlot, proposerIndex} = pendingBlock.blockInput.getBlock().message;
    const fork = this.config.getForkName(blockSlot);
    const proposerBoostWindowMs = this.config.getAttestationDueMs(fork);
    if (
      this.chain.clock.msFromSlot(blockSlot) < proposerBoostWindowMs &&
      this.chain.seenBlockProposers.isKnown(blockSlot, proposerIndex)
    ) {
      // proposer is known by a gossip block already, wait a bit to make sure this block is not
      // eligible for proposer boost to prevent unbundling attack
      this.logger.verbose("Avoid proposer boost for this block of known proposer", {
        slot: blockSlot,
        root: pendingBlock.blockInput.blockRootHex,
        proposerIndex,
      });
      await sleep(proposerBoostWindowMs);
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

    if (res.err) this.metrics?.blockInputSync.processedBlocksError.inc();
    else this.metrics?.blockInputSync.processedBlocksSuccess.inc();

    if (!res.err) {
      // no need to update status to "processed", delete anyway
      this.pendingBlocks.delete(pendingBlock.blockInput.blockRootHex);
      this.chain.seenBlockInputCache.prune(pendingBlock.blockInput.blockRootHex);

      // Send child blocks to the processor
      for (const descendantBlock of getDescendantBlocks(pendingBlock.blockInput.blockRootHex, this.pendingBlocks)) {
        if (isPendingBlockInput(descendantBlock)) {
          this.processBlock(descendantBlock).catch((e) => {
            this.logger.debug("Unexpected error - process descendant block", {}, e);
          });
        }
      }
    } else {
      const errorData = {slot: pendingBlock.blockInput.slot, root: pendingBlock.blockInput.blockRootHex};
      if (res.err instanceof BlockError) {
        switch (res.err.type.code) {
          // This cases are already handled with `{ignoreIfKnown: true}`
          // case BlockErrorCode.ALREADY_KNOWN:
          // case BlockErrorCode.GENESIS_BLOCK:

          case BlockErrorCode.PARENT_UNKNOWN:
          case BlockErrorCode.PRESTATE_MISSING:
            // Should not happen, mark as downloaded to try again latter
            this.logger.debug("Attempted to process block but its parent was still unknown", errorData, res.err);
            pendingBlock.status = PendingBlockInputStatus.downloaded;
            break;

          case BlockErrorCode.EXECUTION_ENGINE_ERROR:
            // Removing the block(s) without penalizing the peers, hoping for EL to
            // recover on a latter download + verify attempt
            this.removeAllDescendants(pendingBlock);
            break;

          default:
            // Block is not correct with respect to our chain. Log error loudly
            this.logger.debug("Error processing block from unknown parent sync", errorData, res.err);
            this.removeAndDownScoreAllDescendants(pendingBlock);
        }
      }

      // Probably a queue error or something unwanted happened, mark as pending to try again latter
      else {
        this.logger.debug("Unknown error processing block from unknown block sync", errorData, res.err);
        pendingBlock.status = PendingBlockInputStatus.downloaded;
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
  private async fetchBlockInput(cacheItem: BlockInputSyncCacheItem): Promise<PendingBlockInput> {
    const rootHex = getBlockInputSyncCacheItemRootHex(cacheItem);
    const excludedPeers = new Set<PeerIdStr>();
    const defaultPendingColumns =
      this.config.getForkSeq(this.chain.clock.currentSlot) >= ForkSeq.fulu
        ? new Set(this.network.custodyConfig.sampledColumns)
        : null;

    const fetchStartSec = Date.now() / 1000;
    let slot = isPendingBlockInput(cacheItem) ? cacheItem.blockInput.slot : undefined;
    if (slot !== undefined) {
      this.metrics?.blockInputSync.fetchBegin.observe(this.chain.clock.secFromSlot(slot, fetchStartSec));
    }

    let i = 0;
    while (i++ < this.getMaxDownloadAttempts()) {
      const pendingColumns =
        isPendingBlockInput(cacheItem) && isBlockInputColumns(cacheItem.blockInput)
          ? new Set(cacheItem.blockInput.getMissingSampledColumnMeta().missing)
          : defaultPendingColumns;
      // pendingDataColumns is null pre-fulu
      const peerMeta = this.peerBalancer.bestPeerForPendingColumns(pendingColumns, excludedPeers);
      if (peerMeta === null) {
        // no more peer with needed columns to try, throw error
        let message = `Error fetching UnknownBlockRoot slot=${slot} root=${rootHex} after ${i}: cannot find peer`;
        if (pendingColumns) {
          message += ` with needed columns=${prettyPrintIndices(Array.from(pendingColumns))}`;
        }
        this.metrics?.blockInputSync.fetchTimeSec.observe(
          {result: FetchResult.FailureTriedAllPeers},
          Date.now() / 1000 - fetchStartSec
        );
        this.metrics?.blockInputSync.fetchPeers.set({result: FetchResult.FailureTriedAllPeers}, i);
        throw Error(message);
      }
      const {peerId, client: peerClient} = peerMeta;

      cacheItem.peerIdStrings.add(peerId);

      try {
        const downloadResult = await downloadByRoot({
          config: this.config,
          network: this.network,
          seenCache: this.chain.seenBlockInputCache,
          emitter: this.chain.emitter,
          peerMeta,
          cacheItem,
        });
        cacheItem = downloadResult.result;
        if (slot === undefined) {
          slot = cacheItem.blockInput.slot;
          // we were not able to observe the time into slot when starting the fetch, do it now
          this.metrics?.blockInputSync.fetchBegin.observe(this.chain.clock.secFromSlot(slot, fetchStartSec));
        }

        const logCtx = {slot, rootHex, peerId, peerClient};
        this.logger.verbose("BlockInputSync.fetchBlockInput: successful download", logCtx);
        this.metrics?.blockInputSync.downloadByRoot.success.inc();
        const warnings = downloadResult.warnings;
        if (warnings) {
          for (const warning of warnings) {
            this.logger.debug("BlockInputSync.fetchBlockInput: downloaded with warning", logCtx, warning);
            this.metrics?.blockInputSync.downloadByRoot.warn.inc({code: warning.type.code, client: peerClient});
          }
          // TODO: penalize peer?
        }
      } catch (e) {
        this.logger.debug(
          "Error downloading in BlockInputSync.fetchBlockInput",
          {slot, rootHex, attempt: i, peer: peerId, peerClient},
          e as Error
        );
        const downloadByRootMetrics = this.metrics?.blockInputSync.downloadByRoot;
        // TODO: penalize peer?
        if (e instanceof DownloadByRootError) {
          const errorCode = e.type.code;
          downloadByRootMetrics?.error.inc({code: errorCode, client: peerClient});
          excludedPeers.add(peerId);
        } else if (e instanceof RequestError) {
          // should look into req_resp metrics in this case
          downloadByRootMetrics?.error.inc({code: "req_resp", client: peerClient});
          switch (e.type.code) {
            case RequestErrorCode.REQUEST_RATE_LIMITED:
            case RequestErrorCode.REQUEST_TIMEOUT:
              // do not exclude peer for these errors
              break;
            default:
              excludedPeers.add(peerId);
              break;
          }
        } else {
          // investigate if this happens
          downloadByRootMetrics?.error.inc({code: "unknown", client: peerClient});
          excludedPeers.add(peerId);
        }
      } finally {
        this.peerBalancer.onRequestCompleted(peerId);
      }

      this.pendingBlocks.set(getBlockInputSyncCacheItemRootHex(cacheItem), cacheItem);

      if (cacheItem.status === PendingBlockInputStatus.downloaded) {
        // download was successful, no need to go with another peer, return
        const result = this.chain.forkChoice.hasBlockHex(cacheItem.blockInput.blockRootHex)
          ? FetchResult.SuccessLate
          : this.chain.forkChoice.hasBlockHex(cacheItem.blockInput.parentRootHex)
            ? FetchResult.SuccessResolved
            : FetchResult.SuccessMissingParent;
        this.metrics?.blockInputSync.fetchTimeSec.observe({result}, Date.now() / 1000 - fetchStartSec);
        this.metrics?.blockInputSync.fetchPeers.set({result}, i);
        return cacheItem;
      }
    } // end while loop over peers

    const message = `Error fetching BlockInput with slot=${slot} root=${rootHex} after ${i - 1} attempts.`;

    if (!isPendingBlockInput(cacheItem)) {
      throw Error(`${message} No block and no data was found.`);
    }

    if (!cacheItem.blockInput.hasBlock()) {
      throw new Error(`${message} Block was not found.`);
    }

    if (isBlockInputBlobs(cacheItem.blockInput)) {
      const missing = cacheItem.blockInput.getMissingBlobMeta().map((b) => b.index);
      if (missing.length) {
        throw new Error(`${message} Missing blob indices=${prettyPrintIndices(missing)}.`);
      }
    }

    if (isBlockInputColumns(cacheItem.blockInput)) {
      const missing = cacheItem.blockInput.getMissingSampledColumnMeta().missing;
      if (missing.length) {
        throw new Error(`${message} Missing column indices=${prettyPrintIndices(missing)}.`);
      }
    }

    this.metrics?.blockInputSync.fetchTimeSec.observe(
      {result: FetchResult.FailureMaxAttempts},
      Date.now() / 1000 - fetchStartSec
    );
    this.metrics?.blockInputSync.fetchPeers.set({result: FetchResult.FailureMaxAttempts}, i - 1);

    throw Error(message);
  }

  /**
   * Gets all descendant blocks of `block` recursively from `pendingBlocks`.
   * Assumes that if a parent block does not exist or is not processable, all descendant blocks are bad too.
   * Downscore all peers that have referenced any of this bad blocks. May report peers multiple times if they have
   * referenced more than one bad block.
   */
  private removeAndDownScoreAllDescendants(block: BlockInputSyncCacheItem): void {
    // Get all blocks that are a descendant of this one
    const badPendingBlocks = this.removeAllDescendants(block);
    // just console log and do not penalize on pending/bad blocks for debugging
    // console.log("removeAndDownscoreAllDescendants", {block});

    for (const block of badPendingBlocks) {
      //
      // TODO(fulu): why is this commented out here?
      //
      //   this.knownBadBlocks.add(block.blockRootHex);
      //   for (const peerIdStr of block.peerIdStrs) {
      //     // TODO: Refactor peerRpcScores to work with peerIdStr only
      //     this.network.reportPeer(peerIdStr, PeerAction.LowToleranceError, "BadBlockByRoot");
      //   }
      this.logger.debug("ignored Banning unknown block", {
        slot: getBlockInputSyncCacheItemSlot(block),
        root: getBlockInputSyncCacheItemRootHex(block),
        peerIdStrings: Array.from(block.peerIdStrings)
          .map((id) => prettyPrintPeerIdStr(id))
          .join(","),
      });
    }

    // Prune knownBadBlocks
    pruneSetToMax(this.knownBadBlocks, MAX_KNOWN_BAD_BLOCKS);
  }

  private removeAllDescendants(block: BlockInputSyncCacheItem): BlockInputSyncCacheItem[] {
    const rootHex = getBlockInputSyncCacheItemRootHex(block);
    const slot = getBlockInputSyncCacheItemSlot(block);
    // Get all blocks that are a descendant of this one
    const badPendingBlocks = [block, ...getAllDescendantBlocks(rootHex, this.pendingBlocks)];

    this.metrics?.blockInputSync.removedBlocks.inc(badPendingBlocks.length);

    for (const block of badPendingBlocks) {
      const rootHex = getBlockInputSyncCacheItemRootHex(block);
      this.pendingBlocks.delete(rootHex);
      this.chain.seenBlockInputCache.prune(rootHex);
      this.logger.debug("Removing bad/unknown/incomplete BlockInputSyncCacheItem", {
        slot,
        blockRoot: rootHex,
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

  constructor() {
    this.peersMeta = new Map();
    this.activeRequests = new Map();
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
  bestPeerForBlockInput(blockInput: IBlockInput, excludedPeers: Set<PeerIdStr>): PeerSyncMeta | null {
    const eligiblePeers: PeerIdStr[] = [];

    if (isBlockInputColumns(blockInput)) {
      const pendingDataColumns: Set<number> = new Set(blockInput.getMissingSampledColumnMeta().missing);
      // there could be no pending column in case when block is still missing
      eligiblePeers.push(...this.filterPeers(pendingDataColumns, excludedPeers));
    } else {
      // prefulu
      eligiblePeers.push(...this.filterPeers(null, excludedPeers));
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
      const {custodyColumns: peerColumns} = syncMeta;
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
