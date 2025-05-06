import {ChainForkConfig} from "@lodestar/config";
import {ForkPostDeneb, INTERVALS_PER_SLOT} from "@lodestar/params";
import {RootHex} from "@lodestar/types";
import {LodestarError, Logger, fromHex, prettyBytes, prettyPrintArray, pruneSetToMax, sleep} from "@lodestar/utils";
import {
  BlockInput,
  BlockInputBlobs,
  BlockInputDataStatus,
  DataAvailabilityStatus,
  convertNewToOldBlobSource,
  convertNewToOldBlockSource,
} from "../chain/blocks/blockInput/index.js";
import {BlockInput as BlockInputOld, getBlockInput} from "../chain/blocks/types.js";
import {BlockError, BlockErrorCode} from "../chain/errors/blockError.js";
import {IBeaconChain} from "../chain/index.js";
import {Metrics} from "../metrics/index.js";
import {INetwork, NetworkEvent, NetworkEventData, PeerAction} from "../network/index.js";
import {PeerIdStr} from "../util/peerId.js";
import {shuffle} from "../util/shuffle.js";
import {wrapError} from "../util/wrapError.js";
import {SyncOptions} from "./options.js";
import {
  BlockInputSyncCacheItem,
  PendingBlockInput,
  PendingBlockInputStatus,
  PendingRootHex,
  getBlockInputSyncCacheItemRootHex,
  isPendingBlockInput,
} from "./types.js";
import {downloadBlockInputByRoot} from "./utils/downloadBlockInputByRoot.js";

const MAX_ATTEMPTS_PER_BLOCK = 5;
const MAX_PENDING_BLOCKS = 100;
const MAX_KNOWN_BAD_BLOCKS = 500;

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
    if (!this.subscribedToNetworkEvents) {
      this.logger.verbose("BlockInputSync enabled.");
      this.network.events.on(NetworkEvent.blockInput, this.onBlockInput);
      this.network.events.on(NetworkEvent.unknownParent, this.onUnknownParent);
      this.network.events.on(NetworkEvent.unknownBlockRoot, this.onUnknownBlockRoot);
      this.network.events.on(NetworkEvent.peerConnected, this.triggerUnknownBlockSearch);
      this.subscribedToNetworkEvents = true;
    }
  }

  unsubscribeFromNetwork(): void {
    this.logger.verbose("BlockInputSync disabled.");
    this.network.events.off(NetworkEvent.blockInput, this.onBlockInput);
    this.network.events.off(NetworkEvent.unknownParent, this.onUnknownParent);
    this.network.events.off(NetworkEvent.unknownBlockRoot, this.onUnknownBlockRoot);
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
   * Process an blockInput event and register the blockInput in `pendingBlocks` Map.
   */
  private onBlockInput = (data: NetworkEventData[NetworkEvent.blockInput]): void => {
    try {
      this.addBlockInput(data.blockInput, data.peer);
      this.triggerUnknownBlockSearch();
      this.metrics?.blockInputSync.onBlockInput.inc({source: data.source});
    } catch (e) {
      this.logger.debug("Error handling blockInput event", {}, e as Error);
    }
  };

  private onUnknownParent = (data: NetworkEventData[NetworkEvent.unknownParent]): void => {
    try {
      const {blockInput, source, peer} = data;
      const parentBlockInput = this.chain.seenBlockInputCache.getBlockInputByRootHex({
        rootHex: blockInput.getParentRootHex(),
      });
      this.addBlockInput(parentBlockInput, peer);
      this.addBlockInput(blockInput, peer);
      this.triggerUnknownBlockSearch();
      this.metrics?.blockInputSync.onUnknownParent.inc({source}, 2);
    } catch (e) {
      this.logger.debug("Error handling unknownParent event", {}, e as Error);
    }
  };

  private onUnknownBlockRoot = (data: NetworkEventData[NetworkEvent.unknownBlockRoot]): void => {
    try {
      this.addUnknownBlockRoot(data.rootHex, data.peer);
      this.triggerUnknownBlockSearch();
      this.metrics?.blockInputSync.onUnknownBlockRoot.inc({source: data.source});
    } catch (e) {
      this.logger.debug("Error handling unknownBlockRoot event", data, e as Error);
    }
  };

  private addUnknownBlockRoot = (rootHex: RootHex, peerIdStr?: PeerIdStr): PendingRootHex => {
    let pendingBlock = this.pendingBlocks.get(rootHex) as PendingRootHex;
    if (!pendingBlock) {
      pendingBlock = {
        status: PendingBlockInputStatus.pending,
        rootHex: rootHex,
        peerIdStrings: new Set(),
        timeAddedSec: Date.now() / 1000,
      };
      this.pendingBlocks.set(rootHex, pendingBlock);

      this.logger.verbose("Added unknown rootHex to BlockInputSync.pendingBlocks", {
        rootHex: pendingBlock.rootHex,
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
      this.logger.warn(`Pruned ${prunedItemCount} items from BlockInputSync.pendingBlocks`);
    }

    return pendingBlock;
  };

  private addBlockInput(blockInput: BlockInput, peerIdStr?: string): PendingBlockInput {
    let pendingBlock = this.pendingBlocks.get(blockInput.rootHex) as PendingBlockInput;
    if (!pendingBlock || !isPendingBlockInput(pendingBlock)) {
      pendingBlock = {
        status: PendingBlockInputStatus.pending,
        blockInput,
        peerIdStrings: new Set(),
        timeAddedSec: Date.now() / 1000,
      };
      this.pendingBlocks.set(blockInput.rootHex, pendingBlock);

      this.logger.verbose("Added blockInput to BlockInputSync.pendingBlocks", pendingBlock.blockInput.getLogMeta());
    }

    if (peerIdStr) {
      pendingBlock.peerIdStrings.add(peerIdStr);
    }

    // TODO: check this prune methodology
    // Limit pending blocks to prevent DOS attacks that cause OOM
    const prunedItemCount = pruneSetToMax(this.pendingBlocks, this.maxPendingBlocks);
    if (prunedItemCount > 0) {
      this.logger.warn(`Pruned ${prunedItemCount} items from BlockInputSync.pendingBlocks`);
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
        if (this.chain.forkChoice.hasBlockHex(block.blockInput.getParentRootHex())) {
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
        const rootHex = prettyBytes(isPendingBlockInput(block) ? block.blockInput.rootHex : block.rootHex);
        this.logger.debug("Unexpected error - downloadBlock", {rootHex}, e);
      });
    }
  };

  private downloadBlock = async (block: BlockInputSyncCacheItem, connectedPeers: PeerIdStr[]): Promise<void> => {
    if (block.status !== PendingBlockInputStatus.pending) {
      return;
    }
    block.status = PendingBlockInputStatus.fetching;

    this.logger.verbose("BlockInputSync.downloadBlock", getLogMeta(block, this.pendingBlocks));

    const res = await wrapError(this.downloadBlockInputByRoot(block, connectedPeers));

    if (res.err) {
      this.metrics?.blockInputSync.downloadError.inc();
      // Give up on this block and assume it does not exist, penalizing all peers as if it was a bad block
      this.logger.debug(
        `Ignoring block that cannot be correctly downloaded after ${MAX_ATTEMPTS_PER_BLOCK} failed attempts`,
        getLogMeta(block, this.pendingBlocks),
        res.err
      );
      this.removeAndDownScoreAllDescendants(block);
      return;
    }

    const pending = res.result;
    const {blockInput} = pending;
    this.pendingBlocks.set(blockInput.rootHex, pending);
    this.metrics?.blockInputSync.downloadSuccess.inc();

    pending.status = PendingBlockInputStatus.downloaded;
    pending.timeSyncedSec = Date.now() / 1000;

    const blockSlot = blockInput.getBlock().message.slot;
    this.metrics?.blockInputSync.timeToSyncSec.observe(pending.timeSyncedSec - pending.timeAddedSec);
    const delaySec = pending.timeSyncedSec - (this.chain.genesisTime + blockSlot * this.config.SECONDS_PER_SLOT);
    this.metrics?.blockInputSync.elapsedTimeTillReceived.observe(delaySec);

    const parentRootHex = blockInput.getParentRootHex();
    const parentInForkChoice = this.chain.forkChoice.hasBlock(fromHex(parentRootHex));
    const finalizedSlot = this.chain.forkChoice.getFinalizedBlock().slot;

    if (parentInForkChoice) {
      // Bingo! Process block. Add to pending blocks anyway for recycle the cache that prevents duplicate processing
      this.processBlock(res.result).catch((e) => {
        this.logger.debug("Unexpected error - process newly downloaded block", {}, e);
      });
    } else if (blockSlot <= finalizedSlot) {
      // the common ancestor of the downloading chain and canonical chain should be at least the finalized slot and
      // we should found it through forkchoice. If not, we should penalize all peers sending us this block chain
      // 0 - 1 - ... - n - finalizedSlot
      //                \
      //                parent 1 - parent 2 - ... - unknownParent block
      this.logger.debug("Downloaded block is before finalized slot", {
        finalizedSlot,
        blockSlot,
        parentRootHex,
        ...blockInput.getLogMeta(),
      });
      this.removeAndDownScoreAllDescendants(block);
    } else {
      this.addUnknownBlockRoot(blockInput.getParentRootHex());
    }
  };

  private downloadBlockInputByRoot = async (
    block: BlockInputSyncCacheItem,
    connectedPeers: PeerIdStr[]
  ): Promise<PendingBlockInput> => {
    const shuffledPeers = shuffle(connectedPeers);
    let pending = block as PendingBlockInput;

    for (let i = 0; i < MAX_ATTEMPTS_PER_BLOCK; i++) {
      const peerIdStr = shuffledPeers[i % shuffledPeers.length];
      pending.peerIdStrings.add(peerIdStr);
      try {
        pending = await downloadBlockInputByRoot({
          config: this.config,
          network: this.network,
          cache: this.chain.seenBlockInputCache,
          executionEngine: this.chain.executionEngine,
          pending,
          peerIdStr,
        });

        if (pending.blockInput.isComplete()) {
          this.logger.debug(
            `Successfully downloaded PendingBlockInput byRoot on attempt number ${i}`,
            getLogMeta(pending)
          );
          return pending;
        }

        this.logger.debug(
          `Unsuccessful/Partial download of PendingBlockInput byRoot on attempt number ${i}`,
          getLogMeta(pending)
        );
      } catch (err) {
        // TODO(@matthewkeil): if block downloads but error happens in data the seenBlockInputCache will be updated to
        //      include the block.  should we check for the block input in the cache and add it to pending so we dont
        //      have to repull it if it was validly received?
        this.logger.debug(`Error downloadBlockInputByRoot in attempt number ${i}`, getLogMeta(pending), err as Error);
      }
    }

    throw new BlockInputSyncError({
      code: BlockInputSyncErrorCode.MAX_ATTEMPTS,
      blockRoot: getBlockInputSyncCacheItemRootHex(pending),
    });
  };

  private processBlock = async (block: PendingBlockInput): Promise<void> => {
    if (block.status !== PendingBlockInputStatus.downloaded) {
      return;
    }

    block.status = PendingBlockInputStatus.processing;

    // this prevents un-bundling attack
    // see https://lighthouse-blog.sigmaprime.io/mev-unbundling-rpc.html
    const {slot: blockSlot, proposerIndex} = block.blockInput.getBlock().message;
    if (
      this.chain.clock.secFromSlot(blockSlot) < this.proposerBoostSecWindow &&
      this.chain.seenBlockProposers.isKnown(blockSlot, proposerIndex)
    ) {
      // proposer is known by a gossip block already, wait a bit to make sure this block is not
      // eligible for proposer boost to prevent un-bundling attack
      this.logger.verbose("Avoid proposer boost for this block of known proposer", {
        blockSlot,
        proposerIndex,
        blockRoot: block.blockInput.prettyRootHex,
      });
      await sleep(this.proposerBoostSecWindow * 1000);
    }

    /**
     * This whole conversion is only to get this to build.  Once the process pipeline is updated this code segment will
     * all go away (along with the helper functions).
     */
    const blockWithSource = block.blockInput.getBlockWithSource();
    let blockInputOld: BlockInputOld;
    switch (block.blockInput.getDataAvailability()) {
      case DataAvailabilityStatus.Available: {
        const blobsWithSource = (block.blockInput as BlockInputBlobs).getAllBlobsWithSource();
        blockInputOld = getBlockInput.availableData(
          this.config,
          blockWithSource.block,
          convertNewToOldBlockSource(blockWithSource.source),
          {
            blobs: blobsWithSource.map(({blobSidecar}) => blobSidecar),
            blobsSource: convertNewToOldBlobSource(blobsWithSource[0].source),
            fork: block.blockInput.getForkName() as ForkPostDeneb,
          }
        );
        break;
      }
      case DataAvailabilityStatus.OutOfRange:
        blockInputOld = getBlockInput.outOfRangeData(
          this.config,
          blockWithSource.block,
          convertNewToOldBlockSource(blockWithSource.source)
        );
        break;
      case DataAvailabilityStatus.PreData:
        blockInputOld = getBlockInput.preData(
          this.config,
          blockWithSource.block,
          convertNewToOldBlockSource(blockWithSource.source)
        );
        break;
      default:
        throw new BlockInputSyncError({
          code: BlockInputSyncErrorCode.INVALID_CONVERSION_TO_OLD_BLOCK_INPUT,
        });
    }

    // At gossip time, it's critical to keep a good number of mesh peers.
    // To do that, the Gossip Job Wait Time should be consistently <3s to avoid the behavior penalties in gossip
    // Gossip Job Wait Time depends on the BLS Job Wait Time
    // so `blsVerifyOnMainThread = true`: we want to verify signatures immediately without affecting the bls thread pool.
    // otherwise we can't utilize bls thread pool capacity and Gossip Job Wait Time can't be kept low consistently.
    // See https://github.com/ChainSafe/lodestar/issues/3792
    const res = await wrapError(
      this.chain.processBlock(blockInputOld, {
        ignoreIfKnown: true,
        // there could be finalized/head sync at the same time so we need to ignore if finalized
        // see https://github.com/ChainSafe/lodestar/issues/5650
        ignoreIfFinalized: true,
        blsVerifyOnMainThread: true,
        // block is validated with correct root, we want to process it as soon as possible
        eagerPersistBlock: true,
      })
    );

    if (res.err) {
      this.metrics?.blockInputSync.processError.inc();
      if (res.err instanceof BlockError) {
        switch (res.err.type.code) {
          // This cases are already handled with `{ignoreIfKnown: true}`
          // case BlockErrorCode.ALREADY_KNOWN:
          // case BlockErrorCode.GENESIS_BLOCK:

          case BlockErrorCode.PARENT_UNKNOWN:
          case BlockErrorCode.PRESTATE_MISSING:
            // Should not happen, mark as downloaded to try again latter
            this.logger.debug(
              "Attempted to process block but its parent was still unknown",
              block.blockInput.getLogMeta(),
              res.err
            );
            block.status = PendingBlockInputStatus.downloaded;
            break;

          case BlockErrorCode.EXECUTION_ENGINE_ERROR:
            // Removing the block(s) without penalizing the peers, hoping for EL to
            // recover on a latter download + verify attempt
            this.removeAllDescendants(block);
            break;

          default:
            // Block is not correct with respect to our chain. Log error loudly
            this.logger.debug(
              "Error processing block from unknown parent sync",
              block.blockInput.getLogMeta(),
              res.err
            );
            this.removeAndDownScoreAllDescendants(block);
        }
      } else {
        this.logger.debug(
          "Unknown error processing block from unknown block sync",
          block.blockInput.getLogMeta(),
          res.err
        );
        block.status = PendingBlockInputStatus.downloaded;
      }
      return;
    }

    this.metrics?.blockInputSync.processSuccess.inc();
    // no need to update status to "processed", delete anyway
    this.pendingBlocks.delete(block.blockInput.rootHex);

    // Send child blocks to the processor
    for (const descendantBlock of getDescendantBlocks(block.blockInput.rootHex, this.pendingBlocks)) {
      if (isPendingBlockInput(descendantBlock)) {
        this.processBlock(descendantBlock).catch((e) => {
          this.logger.debug("Unexpected error - process descendant block", getLogMeta(descendantBlock), e);
        });
      }
    }
  };

  private removeAllDescendants = (block: BlockInputSyncCacheItem): BlockInputSyncCacheItem[] => {
    // Get all blocks that are a descendant of this one
    const badPendingBlocks = [
      block,
      ...getDescendantBlocks(getBlockInputSyncCacheItemRootHex(block), this.pendingBlocks),
    ];

    this.metrics?.blockInputSync.removeBadBlocks.inc(badPendingBlocks.length);

    for (const badBlock of badPendingBlocks) {
      this.pendingBlocks.delete(getBlockInputSyncCacheItemRootHex(badBlock));
      this.logger.debug("Removing badPendingBlock", {
        rootHex: getBlockInputSyncCacheItemRootHex(badBlock),
      });
    }

    return badPendingBlocks;
  };

  private removeAndDownScoreAllDescendants = (block: BlockInputSyncCacheItem) => {
    // Get all blocks that are a descendant of this one
    const badPendingBlocks = this.removeAllDescendants(block);

    for (const block of badPendingBlocks) {
      const rootHex = getBlockInputSyncCacheItemRootHex(block);
      this.knownBadBlocks.add(rootHex);
      for (const peerIdStr of block.peerIdStrings) {
        // TODO: Refactor peerRpcScores to work with peerIdStr only
        this.network.reportPeer(peerIdStr, PeerAction.LowToleranceError, "BadBlockByRoot");
      }
      this.logger.debug("Banning knownBadBlock and down-scored peers", {
        blocRoot: rootHex,
        peerIdStrings: prettyPrintArray(Array.from(block.peerIdStrings)),
      });
    }

    // Prune knownBadBlocks
    pruneSetToMax(this.knownBadBlocks, MAX_KNOWN_BAD_BLOCKS);
  };
}

type UnknownAndAncestorBlocks = {
  unknowns: BlockInputSyncCacheItem[];
  ancestors: PendingBlockInput[];
};

/**
 * Given this chain segment unknown block n => downloaded block n + 1 => downloaded block n + 2
 *   return `{unknowns: [n], ancestors: []}`
 *
 * Given this chain segment: downloaded block n => downloaded block n + 1 => downloaded block n + 2
 *   return {unknowns: [], ancestors: [n]}
 */
function getUnknownAndAncestorBlocks(blocks: Map<RootHex, BlockInputSyncCacheItem>): UnknownAndAncestorBlocks {
  const unknowns: BlockInputSyncCacheItem[] = [];
  const ancestors: PendingBlockInput[] = [];

  for (const block of blocks.values()) {
    if (!isPendingBlockInput(block)) {
      unknowns.push(block);
      continue;
    }

    const parentHex = block.blockInput.getParentRootHex(false);
    if (
      block.status === PendingBlockInputStatus.pending &&
      (!block.blockInput.hasBlock() || block.blockInput.needsData())
      // && !parentHex
      // TODO: (@matthewkeil) Does this condition need to be here still? The
      //       parentHex will be known if any data or if the block has arrived
    ) {
      unknowns.push(block);
    }

    if (block.status === PendingBlockInputStatus.downloaded && parentHex && !blocks.has(parentHex)) {
      ancestors.push(block);
    }
  }

  return {unknowns, ancestors};
}

export function getDescendantBlocks(
  blockRootHex: RootHex,
  blocks: Map<RootHex, BlockInputSyncCacheItem>
): BlockInputSyncCacheItem[] {
  const descendantBlocks: BlockInputSyncCacheItem[] = [];

  for (const block of blocks.values()) {
    if (isPendingBlockInput(block) && block.blockInput.getParentRootHex(false) === blockRootHex) {
      descendantBlocks.push(block);
    }
  }

  return descendantBlocks;
}

enum BlockInputSyncErrorCode {
  INVALID_CONVERSION_TO_OLD_BLOCK_INPUT = "BLOCK_INPUT_SYNC_ERROR_INVALID_CONVERSION_TO_OLD_BLOCK_INPUT",
  MAX_ATTEMPTS = "BLOCK_INPUT_SYNC_ERROR_MAX_ATTEMPTS",

  Z = "BLOCK_INPUT_SYNC_ERROR_Z",
}
type BlockInputSyncErrorType =
  | {
      code: BlockInputSyncErrorCode.INVALID_CONVERSION_TO_OLD_BLOCK_INPUT;
    }
  | {
      code: BlockInputSyncErrorCode.MAX_ATTEMPTS;
      blockRoot: RootHex;
    };
class BlockInputSyncError extends LodestarError<BlockInputSyncErrorType> {}
