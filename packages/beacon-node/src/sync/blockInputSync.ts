import {ChainForkConfig} from "@lodestar/config";
import {ForkName, INTERVALS_PER_SLOT, NUMBER_OF_COLUMNS} from "@lodestar/params";
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
import {byteArrayEquals} from "../util/bytes.js";
import {PeerIdStr} from "../util/peerId.js";
import {shuffle} from "../util/shuffle.js";
import {Result, wrapError} from "../util/wrapError.js";
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
      this.network.events.on(NetworkEvent.peerConnected, this.triggerUnknownBlockSearch);
      this.subscribedToNetworkEvents = true;
    }
  }

  unsubscribeFromNetwork(): void {
    this.logger.verbose("BlockInputSync disabled.");
    this.chain.emitter.off(ChainEvent.unknownBlockRoot, this.onUnknownBlockRoot);
    this.chain.emitter.off(ChainEvent.incompleteBlockInput, this.onIncompleteBlockInput);
    this.chain.emitter.off(ChainEvent.unknownParent, this.onUnknownParent);
    this.network.events.off(NetworkEvent.peerConnected, this.triggerUnknownBlockSearch);
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
      this.downloadBlock(block, connectedPeers).catch((e) => {
        this.logger.debug("Unexpected error - downloadBlock", {root: getBlockInputSyncCacheItemRootHex(block)}, e);
      });
    }
  };

  private async downloadBlock(block: BlockInputSyncCacheItem, allPeers: PeerIdStr[]): Promise<void> {
    if (block.status !== PendingBlockInputStatus.pending) {
      return;
    }

    const unknownBlockType = block.unknownBlockType;
    const rootHex = getBlockInputSyncCacheItemRootHex(block);
    const logCtx = {
      root: rootHex,
      pendingBlocks: this.pendingBlocks.size,
      slot: (block as PendingBlockInput).blockInput?.slot ?? "unknown",
      unknownBlockType,
    };

    this.logger.verbose("Downloading unknown block", logCtx);

    block.status = PendingBlockInputStatus.fetching;

    let res: Result<{blockInput: IBlockInput; peerIdStr: string}>;
    let connectedPeers: string[];
    if (!isPendingBlockInput(block)) {
      connectedPeers = allPeers;
      // we only have block root, and nothing else
      res = await wrapError(this.fetchUnknownBlockRoot(fromHex(rootHex), connectedPeers));
    } else {
      if (isBlockInputColumns(block.blockInput)) {
        const neededColumns = block.blockInput.getMissingSampledColumnMeta().map((c) => c.index);

        connectedPeers =
          neededColumns.length <= 0
            ? allPeers
            : allPeers.filter((peer) => {
                const {custodyGroups: peerColumns} = this.network.getConnectedPeerSyncMeta(peer);
                const columns = peerColumns.reduce((acc, elem) => {
                  if (neededColumns.includes(elem)) {
                    acc.push(elem);
                  }
                  return acc;
                }, [] as number[]);
                return columns.length > 0;
              });
        if (connectedPeers.length > 0) {
          this.logger.debug("Filtered peers to those having relevant columns for downloading data", {
            ...logCtx,
            allPeers: allPeers.length,
            connectedPeers: connectedPeers.length,
          });
        } else {
          this.logger.debug("Skipping download as no filtered peers having relevant data", {
            ...logCtx,
            allPeers: allPeers.length,
            connectedPeers: connectedPeers.length,
            neededColumns: neededColumns.join(" "),
          });
          return;
        }
      } else {
        connectedPeers = allPeers;
      }
      res = await wrapError(this.fetchUnavailableBlockInput(block.blockInput, connectedPeers));
    }

    if (res.err) this.metrics?.blockInputSync.downloadedBlocksError.inc();
    else this.metrics?.blockInputSync.downloadedBlocksSuccess.inc();

    let peerIdStr: PeerIdStr | undefined;
    if (!res.err) {
      (block as PendingBlockInput).blockInput = res.result.blockInput;
      peerIdStr = res.result.peerIdStr;
    }

    if (isPendingBlockInput(block)) {
      const blockInput = block.blockInput;
      if (!blockInput.hasAllData()) {
        // if there were any peers who would have had the missing datacolumns, it would have resulted in err
        block.status = PendingBlockInputStatus.pending;
        this.pendingBlocks.set(blockInput.blockRootHex, block);
        // parentSlot > finalizedSlot, continue downloading parent of parent
        block.downloadAttempts += this.config.CUSTODY_REQUIREMENT / NUMBER_OF_COLUMNS;
        const errorData = {root: blockInput.blockRootHex, attempts: block.downloadAttempts, unknownBlockType};
        if (block.downloadAttempts > MAX_ATTEMPTS_PER_BLOCK) {
          // Give up on this block and assume it does not exist, penalizing all peers as if it was a bad block
          this.logger.debug("Ignoring unknown block after many failed downloads", errorData);
          this.removeAndDownscoreAllDescendants(block);
        } else {
          // Try again when a new peer connects, its status changes, or a new unknownBlockParent event happens
          this.logger.debug("Error downloading full unknown block", errorData);
        }
      } else {
        block.status = PendingBlockInputStatus.downloaded;
        this.pendingBlocks.set(blockInput.blockRootHex, block);
        const blockSlot = blockInput.slot;
        const finalizedSlot = this.chain.forkChoice.getFinalizedBlock().slot;
        const delaySec = Date.now() / 1000 - (this.chain.genesisTime + blockSlot * this.config.SECONDS_PER_SLOT);
        this.metrics?.blockInputSync.elapsedTimeTillReceived.observe(delaySec);

        const parentInForkchoice = this.chain.forkChoice.hasBlockHex(blockInput.parentRootHex);
        this.logger.verbose("Downloaded unknown block", {
          root: blockInput.blockRootHex,
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
          const blockRoot = this.config.getForkTypes(blockSlot).BeaconBlock.hashTreeRoot(blockInput.getBlock().message);
          this.logger.debug("Downloaded block is before finalized slot", {
            finalizedSlot,
            blockSlot,
            parentRoot: toRootHex(blockRoot),
            unknownBlockType,
          });
          this.removeAndDownscoreAllDescendants(block);
        } else {
          this.onUnknownParent({blockInput, peer: peerIdStr as string, source: BlockInputSource.byRoot});
        }
      }
    } else {
      // this allows to retry the download of the block
      block.status = PendingBlockInputStatus.pending;
      // parentSlot > finalizedSlot, continue downloading parent of parent
      block.downloadAttempts++;
      const errorData = {root: block.rootHex, attempts: block.downloadAttempts, unknownBlockType};
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
  private async processBlock(pendingBlock: PendingBlockInput): Promise<void> {
    // pending block status is `downloaded` right after `downloadBlock`
    // but could be `pending` if added by `onUnknownBlockParent` event and this function is called recursively
    if (pendingBlock.status !== PendingBlockInputStatus.downloaded) {
      if (pendingBlock.status === PendingBlockInputStatus.pending) {
        const connectedPeers = this.network.getConnectedPeers();
        if (connectedPeers.length === 0) {
          this.logger.debug("No connected peers, skipping download block", {
            blockRoot: pendingBlock.blockInput.blockRootHex,
          });
          return;
        }
        // if the download is a success we'll call `processBlock()` for this block
        await this.downloadBlock(pendingBlock, connectedPeers);
      }
      return;
    }

    pendingBlock.status = PendingBlockInputStatus.processing;
    // this prevents unbundling attack
    // see https://lighthouse-blog.sigmaprime.io/mev-unbundling-rpc.html
    const {slot: blockSlot, proposerIndex} = pendingBlock.blockInput.getBlock().message;
    const blockRootHex = pendingBlock.blockInput.blockRootHex;
    if (
      this.chain.clock.secFromSlot(blockSlot) < this.proposerBoostSecWindow &&
      this.chain.seenBlockProposers.isKnown(blockSlot, proposerIndex)
    ) {
      // proposer is known by a gossip block already, wait a bit to make sure this block is not
      // eligible for proposer boost to prevent unbundling attack
      this.logger.verbose("Avoid proposer boost for this block of known proposer", {
        blockSlot,
        blockRoot: blockRootHex,
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

    if (res.err) this.metrics?.blockInputSync.processedBlocksError.inc();
    else this.metrics?.blockInputSync.processedBlocksSuccess.inc();

    if (!res.err) {
      // no need to update status to "processed", delete anyway
      this.pendingBlocks.delete(blockRootHex);

      // Send child blocks to the processor
      for (const descendantBlock of getDescendantBlocks(blockRootHex, this.pendingBlocks)) {
        this.processBlock(descendantBlock).catch((e) => {
          this.logger.debug("Unexpected error - process descendant block", {}, e);
        });
      }
    } else {
      const errorData = {root: blockRootHex, slot: blockSlot};
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
   * Will attempt a max of `MAX_ATTEMPTS_PER_BLOCK` on different peers if connectPeers.length > MAX_ATTEMPTS_PER_BLOCK.
   * Also verifies the received block root + returns the peer that provided the block for future downscoring.
   */
  private async fetchUnknownBlockRoot(
    blockRoot: Root,
    connectedPeers: PeerIdStr[]
  ): Promise<{blockInput: IBlockInput; peerIdStr: string}> {
    const shuffledPeers = shuffle(connectedPeers);
    const blockRootHex = toRootHex(blockRoot);

    let lastError: Error | null = null;
    let partialDownload = null;
    let fetchedPeerId = null;
    for (let i = 0; i < MAX_ATTEMPTS_PER_BLOCK; i++) {
      const peerId = shuffledPeers[i % shuffledPeers.length];
      const {custodyGroups: peerColumns, client: peerClient} = this.network.getConnectedPeerSyncMeta(peerId);
      if (partialDownload !== null) {
        const [prevBlockInput] = partialDownload.blocks;
        if (prevBlockInput === undefined || prevBlockInput.type !== BlockInputType.dataPromise) {
          throw Error(`prevBlockInput=${prevBlockInput?.type} in partialDownload`);
        }
        const {cachedData} = prevBlockInput;
        if (cachedData.fork === ForkName.fulu) {
          const {dataColumnsCache} = cachedData as CachedDataColumns;
          const sampledColumns = this.network.custodyConfig.sampledColumns;
          const neededColumns = sampledColumns.reduce((acc, elem) => {
            if (dataColumnsCache.get(elem) === undefined) {
              acc.push(elem);
            }
            return acc;
          }, [] as number[]);
          const columns = peerColumns.reduce((acc, elem) => {
            if (neededColumns.includes(elem)) {
              acc.push(elem);
            }
            return acc;
          }, [] as number[]);

          if (columns.length === 0) {
            continue;
          }
        }
      }

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
          fetchedPeerId = peerId;
          continue;
        }

        // Verify block root is correct
        const block = blockInput.block.message;
        const receivedBlockRoot = this.config.getForkTypes(block.slot).BeaconBlock.hashTreeRoot(block);
        if (!byteArrayEquals(receivedBlockRoot, blockRoot)) {
          throw Error(`Wrong block received by peer, got ${toRootHex(receivedBlockRoot)} expected ${blockRootHex}`);
        }

        return {blockInput, peerIdStr: peerId};
      } catch (e) {
        this.logger.debug("Error fetching UnknownBlockRoot", {attempt: i, blockRootHex, peer: peerId}, e as Error);
        lastError = e as Error;
      }
    }

    if (lastError) {
      lastError.message = `Error fetching UnknownBlockRoot after ${MAX_ATTEMPTS_PER_BLOCK} attempts: ${lastError.message}`;
      throw lastError;
    }
    if (partialDownload !== null && fetchedPeerId !== null) {
      const {
        blocks: [blockInput],
      } = partialDownload;
      return {blockInput, peerIdStr: fetchedPeerId};
    }
    throw Error(
      `Error fetching UnknownBlockRoot after ${MAX_ATTEMPTS_PER_BLOCK}: unknown error because either partialDownload is null=${partialDownload === null} or fetchedPeerId is null=${fetchedPeerId === null} `
    );
  }

  /**
   * We have partial block input:
   * - we have block but not have all blobs (deneb) or needed columns (fulu)
   * - we don't have block and have some blobs (deneb) or some columns (fulu)
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
    for (let i = 0; i < MAX_ATTEMPTS_PER_BLOCK; i++) {
      const peerId = shuffledPeers[i % shuffledPeers.length];
      const {custodyGroups: peerColumns, client: peerClient} = this.network.getConnectedPeerSyncMeta(peerId);
      if (unavailableBlockInput.block !== null) {
        const {cachedData} = unavailableBlockInput;
        if (cachedData.fork === ForkName.fulu) {
          const {dataColumnsCache} = cachedData as CachedDataColumns;
          const neededColumns = sampledColumns.reduce((acc, elem) => {
            if (dataColumnsCache.get(elem) === undefined) {
              acc.push(elem);
            }
            return acc;
          }, [] as number[]);
          const columns = peerColumns.reduce((acc, elem) => {
            if (neededColumns.includes(elem)) {
              acc.push(elem);
            }
            return acc;
          }, [] as number[]);

          if (columns.length === 0) {
            continue;
          }
        }
      }

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

        // Peer does not have the block, try with next peer
        if (blockInput === undefined) {
          continue;
        }

        if (unavailableBlockInput.block !== null && blockInput.type === BlockInputType.dataPromise) {
          // all datacolumns were not downloaded we can continue with other peers
          // as unavailableBlockInput.block's dataColumnsCache would be updated
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
          this.logger.debug("Fetched UnavailableBlockInput", {attempts: i, ...dataMeta, blobKzgCommitmentsLen});
        }

        return {blockInput, peerIdStr: peerId};
      } catch (e) {
        this.logger.debug("Error fetching UnavailableBlockInput", {attempt: i, blockRootHex, peer: peerId}, e as Error);
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

    this.metrics?.blockInputSync.removedBlocks.inc(badPendingBlocks.length);

    for (const block of badPendingBlocks) {
      this.pendingBlocks.delete(block.blockRootHex);
      this.logger.debug("Removing unknown parent block", {
        root: block.blockRootHex,
      });
    }

    return badPendingBlocks;
  }
}
