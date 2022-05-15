import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {ILogger, prettyBytes} from "@chainsafe/lodestar-utils";
import {allForks, Root, RootHex} from "@chainsafe/lodestar-types";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {INetwork, NetworkEvent, PeerAction} from "../network";
import {IBeaconChain} from "../chain";
import {IMetrics} from "../metrics";
import {shuffle} from "../util/shuffle";
import {byteArrayEquals} from "../util/bytes";
import PeerId from "peer-id";
import {BlockError, BlockErrorCode} from "../chain/errors";
import {wrapError} from "../util/wrapError";
import {pruneSetToMax} from "../util/map";
import {PendingBlock, PendingBlockStatus, PendingBlockToProcess, PendingBlockType} from "./interface";
import {getDescendantBlocks, getAllDescendantBlocks, getBlocksToDownload} from "./utils/pendingBlocksTree";
import {SyncOptions} from "./options";
import {BlockSource} from "../chain/blocks/types";

const MAX_ATTEMPTS_PER_BLOCK = 5;
const MAX_KNOWN_BAD_BLOCKS = 500;
const MAX_PENDING_BLOCKS = 100;
const MIN_TIME_SINCE_LAST_QUERY_MS = 500;

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
      this.network.events.on(NetworkEvent.unknownBlock, this.onUnknownBlock);
      this.network.events.on(NetworkEvent.unknownBlockParent, this.onUnknownBlockParent);
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
    this.network.events.off(NetworkEvent.unknownBlock, this.onUnknownBlock);
    this.network.events.off(NetworkEvent.unknownBlockParent, this.onUnknownBlockParent);
    this.network.events.off(NetworkEvent.peerConnected, this.triggerUnknownBlockSearch);
  }

  /**
   * Process an unknownBlock event and register the block in `pendingBlocks` Map.
   */
  private onUnknownBlock = (rootHex: RootHex, peerIdStr: string): void => {
    try {
      this.addUnknownBlock(rootHex, peerIdStr);
      this.triggerUnknownBlockSearch();
      this.metrics?.syncUnknownBlock.requests.inc({type: PendingBlockType.UNKNOWN_BLOCK});
    } catch (e) {
      this.logger.error("Error handling unknownBlock event", {}, e as Error);
    }
  };

  /**
   * Process an unknownBlockParent event and register the block in `pendingBlocks` Map.
   */
  private onUnknownBlockParent = (signedBlock: allForks.SignedBeaconBlock, peerIdStr: string): void => {
    try {
      this.addUnknownBlockParent(signedBlock, peerIdStr);
      this.triggerUnknownBlockSearch();
      this.metrics?.syncUnknownBlock.requests.inc({type: PendingBlockType.UNKNOWN_PARENT});
    } catch (e) {
      this.logger.error("Error handling unknownBlockParent event", {}, e as Error);
    }
  };

  private addUnknownBlock(blockRootHex: RootHex, peerIdStr: string): PendingBlock {
    let pendingBlock = this.pendingBlocks.get(blockRootHex);
    if (!pendingBlock) {
      pendingBlock = {
        status: PendingBlockStatus.toDownload,
        blockRootHex,
        peerIdStrs: new Set(),
        downloadAttempts: 0,
        lastQueriedTimeByPeer: new Map(),
        receivedTimeSec: Date.now() / 1000,
        processing: false,
      };
      this.pendingBlocks.set(blockRootHex, pendingBlock);
    }
    pendingBlock.peerIdStrs.add(peerIdStr);
    this.prunePendingBlocks();

    return pendingBlock;
  }

  /**
   * An unknown parent block comes
   */
  private addUnknownBlockParent(signedBlock: allForks.SignedBeaconBlock, peerIdStr: string): PendingBlockToProcess {
    const pendingBlock = this.toBlockToProcess(signedBlock, peerIdStr);
    // Add parent block as pending, if it's known by pendingBlocks this will not add it
    this.addUnknownBlock(pendingBlock.parentBlockRootHex, peerIdStr);
    return pendingBlock;
  }

  /**
   * An unknown parent block comes
   * Or an toDownload block was downloaded, transform to toProcess
   */
  private toBlockToProcess(signedBlock: allForks.SignedBeaconBlock, peerIdStr: string): PendingBlockToProcess {
    const block = signedBlock.message;
    const blockRoot = this.config.getForkTypes(block.slot).BeaconBlock.hashTreeRoot(block);
    const blockRootHex = toHexString(blockRoot);
    const parentBlockRootHex = toHexString(block.parentRoot);

    let pendingBlock = this.pendingBlocks.get(blockRootHex);
    if (!pendingBlock) {
      pendingBlock = {
        status: PendingBlockStatus.toProcess,
        blockRootHex,
        parentBlockRootHex,
        signedBlock,
        peerIdStrs: new Set(),
        downloadAttempts: 0,
        lastQueriedTimeByPeer: new Map(),
        receivedTimeSec: Date.now() / 1000,
        processing: false,
      };
      this.pendingBlocks.set(blockRootHex, pendingBlock);
    } else if (pendingBlock.status === PendingBlockStatus.toDownload) {
      pendingBlock = {
        ...pendingBlock,
        status: PendingBlockStatus.toProcess,
        signedBlock,
        parentBlockRootHex,
      };
      this.pendingBlocks.set(blockRootHex, pendingBlock);
    }

    pendingBlock.peerIdStrs.add(peerIdStr);
    this.prunePendingBlocks();
    return pendingBlock;
  }

  private prunePendingBlocks(): void {
    // Limit pending blocks to prevent DOS attacks that cause OOM
    const prunedItemCount = pruneSetToMax(this.pendingBlocks, MAX_PENDING_BLOCKS);
    if (prunedItemCount > 0) {
      this.logger.warn(`Pruned ${prunedItemCount} pending blocks from UnknownBlockSync`);
    }
  }

  /**
   * Gather tip parent blocks with unknown parent and do a search for all of them
   */
  private triggerUnknownBlockSearch = (): void => {
    // Cheap early stop to prevent calling the network.getSyncedPeers()
    if (this.pendingBlocks.size === 0) {
      return;
    }

    // If the node loses all peers with pending unknown blocks, the sync will stall
    const syncedPeers = this.network.getSyncedPeers();
    if (syncedPeers.length === 0) {
      return;
    }

    for (const block of getBlocksToDownload(this.pendingBlocks)) {
      this.downloadUnknownBlock(block, syncedPeers).catch((e) => {
        this.logger.error("Unexpect error - downloadUnknownBlock", {}, e);
      });
    }
  };

  private async downloadUnknownBlock(pendingBlock: PendingBlock, syncedPeers: PeerId[]): Promise<void> {
    if (pendingBlock.status !== PendingBlockStatus.toDownload || pendingBlock.processing) {
      return;
    }

    pendingBlock.processing = true;
    const {blockRootHex, downloadAttempts, receivedTimeSec} = pendingBlock;
    const res = await this.fetchUnknownBlockRoot(pendingBlock, fromHexString(blockRootHex), syncedPeers);
    pendingBlock.processing = false;

    const downloadSec = Date.now() / 1000 - receivedTimeSec;
    const logCtx = {
      root: blockRootHex,
      downloadAttempts,
      queriedCount: res.attempt,
      downloadSec,
    };

    if (res.signedBlock !== undefined) {
      this.metrics?.syncUnknownBlock.downloadedBlocksSuccess.inc();
      const {signedBlock, peerIdStr} = res;
      this.logger.verbose("Successfully download unknown block", {...logCtx, slot: res.signedBlock.message.slot});
      this.metrics?.syncUnknownBlock.downloadTime.observe(downloadSec);
      if (this.chain.forkChoice.hasBlock(signedBlock.message.parentRoot)) {
        // Bingo! Process block. Add to pending blocks anyway for recycle the cache that prevents duplicate processing
        this.processBlock(this.toBlockToProcess(signedBlock, peerIdStr)).catch((e) => {
          this.logger.error("Unexpect error - processBlock", {}, e);
        });
      } else {
        this.onUnknownBlockParent(signedBlock, peerIdStr);
      }
    } else {
      if (res.attempt > 0) {
        pendingBlock.downloadAttempts++;
        this.metrics?.syncUnknownBlock.downloadedBlocksError.inc();
        if (downloadAttempts > MAX_ATTEMPTS_PER_BLOCK) {
          // Give up on this block and assume it does not exist, penalizing all peers as if it was a bad block
          this.logger.error("Ignoring unknown block root after many failed downloads", logCtx, res.err);
          this.removeAndDownscoreAllDescendants(pendingBlock);
        } else {
          // Try again when a new peer connects, its status changes, or a new unknownBlockParent event happens
          this.logger.debug("Error downloading unknown block root", logCtx, res.err);
        }
      } else {
        // else attempt = 0: maybe too few peers and we asked them in recent MIN_TIME_SINCE_LAST_QUERY_MS
        // do not increase downloadAttempts in this case
        this.logger.verbose("No attempt to download unknown block root", logCtx);
      }
    }
  }

  /**
   * Send block to the processor awaiting completition. If processed successfully, send all children to the processor.
   * On error, remove and downscore all descendants.
   */
  private async processBlock(pendingBlock: PendingBlock): Promise<void> {
    if (pendingBlock.status !== PendingBlockStatus.toProcess || pendingBlock.processing) {
      return;
    }

    const {signedBlock, blockRootHex} = pendingBlock;

    pendingBlock.processing = true;
    const res = await wrapError(
      this.chain.processBlock(signedBlock, {
        // it's very possible that gossip block comes and be processed before this downloaded block
        ignoreIfKnown: true,
        // At gossip time, it's critical to keep a good number of mesh peers.
        // To do that, the Gossip Job Wait Time should be consistently <3s to avoid the behavior penalties in gossip
        // Gossip Job Wait Time depends on the BLS Job Wait Time
        // so `blsVerifyOnMainThread = true`: we want to verify signatures immediately without affecting the bls thread pool.
        // otherwise we can't utilize bls thread pool capacity and Gossip Job Wait Time can't be kept low consistently.
        // See https://github.com/ChainSafe/lodestar/issues/3792
        blsVerifyOnMainThread: true,
        source: BlockSource.UNKNOWN_BLOCK_SYNC,
      })
    );
    pendingBlock.processing = false;

    if (!res.err) {
      this.metrics?.syncUnknownBlock.processedBlocksSuccess.inc();
      this.logger.verbose("Fetched and processed block", {
        root: prettyBytes(blockRootHex),
        slot: signedBlock.message.slot,
        sinceSlot: this.chain.clock.secFromSlot(signedBlock.message.slot),
        downloadAttempts: pendingBlock.downloadAttempts,
      });
      this.pendingBlocks.delete(blockRootHex);

      // Send child blocks to the processor
      for (const descendantBlock of getDescendantBlocks(blockRootHex, this.pendingBlocks)) {
        this.processBlock(descendantBlock).catch((e) => {
          this.logger.error("Unexpect error - processBlock", {}, e);
        });
      }
    } else {
      this.metrics?.syncUnknownBlock.processedBlocksError.inc();
      const errorData = {root: blockRootHex, slot: signedBlock.message.slot};
      if (res.err instanceof BlockError) {
        switch (res.err.type.code) {
          // This cases are already handled with `{ignoreIfKnown: true}`
          // case BlockErrorCode.ALREADY_KNOWN:
          // case BlockErrorCode.GENESIS_BLOCK:

          case BlockErrorCode.PARENT_UNKNOWN:
          case BlockErrorCode.PRESTATE_MISSING:
            // Should no happen, mark as pending to try again latter
            this.logger.error("Attempted to process block but its parent was still unknown", errorData, res.err);
            break;

          case BlockErrorCode.EXECUTION_ENGINE_ERROR:
            // Removing the block(s) without penalizing the peers, hoping for EL to
            // recover on a latter download + verify attempt
            this.removeAllDescendants(pendingBlock);
            break;

          default:
            // Block is not correct with respect to our chain. Log error loudly
            this.logger.error("Error processing block from unknown sync", errorData, res.err);
            this.removeAndDownscoreAllDescendants(pendingBlock);
        }
      }

      // Probably a queue error or something unwanted happened, mark as pending to try again latter
      else {
        this.logger.error("Unknown error processing block from unknown sync", errorData, res.err);
      }
    }
  }

  /**
   * Fetches the parent of a block by root from a set of shuffled peers.
   * Will attempt a max of `MAX_ATTEMPTS_PER_BLOCK` on different peers if connectPeers.length > MAX_ATTEMPTS_PER_BLOCK.
   * Also verifies the received block root + returns the peer that provided the block for future downscoring.
   */
  private async fetchUnknownBlockRoot(
    pendingBlock: PendingBlock,
    blockRoot: Root,
    syncedPeers: PeerId[]
  ): Promise<
    | {signedBlock: allForks.SignedBeaconBlock; attempt: number; peerIdStr: string}
    | {signedBlock: undefined; attempt: number; err: Error}
  > {
    const shuffledPeers = shuffle(syncedPeers);
    const blockRootHex = toHexString(blockRoot);
    const {lastQueriedTimeByPeer} = pendingBlock;

    let lastError: Error | null = null;
    const now = Date.now();
    let attempt = 0;
    for (const peer of shuffledPeers) {
      if (attempt >= MAX_ATTEMPTS_PER_BLOCK) break;
      const lastQueriedTime = lastQueriedTimeByPeer.get(peer) ?? 0;
      // unknown block root attestations come before unknown parent block
      // it's likely we'll ask for same root in a short period repeatedly
      // we don't want to keep querying same peer in this case
      // otherwise, this leads to banning the sent peerIds by just querying only 1-2 synced peers
      if (now - lastQueriedTime <= MIN_TIME_SINCE_LAST_QUERY_MS) continue;
      lastQueriedTimeByPeer.set(peer, now);

      try {
        attempt++;
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

        return {signedBlock, attempt, peerIdStr: peer.toB58String()};
      } catch (e) {
        this.logger.debug(
          "Error fetching UnknownBlockRoot",
          {attempt, blockRootHex, peer: peer.toB58String()},
          e as Error
        );
        lastError = e as Error;
      }
    }

    let err: Error;
    if (lastError) {
      lastError.message = `Error fetching UnknownBlockRoot after ${attempt} attempts: ${lastError.message}`;
      err = lastError;
    } else {
      err = Error(`Error fetching UnknownBlockRoot after ${attempt} attempts: unknown error`);
      this.logger.error("Error fetching UnknownBlockRoot", {blockRootHex, queriedCount: attempt});
    }
    return {signedBlock: undefined, attempt, err};
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
      this.logger.error("Banning unknown block", {
        root: block.blockRootHex,
        slot: block.status === PendingBlockStatus.toProcess ? block.signedBlock.message.slot : "toDownload",
      });

      for (const peerIdStr of block.peerIdStrs) {
        // TODO: Refactor peerRpcScores to work with peerIdStr only
        const peer = PeerId.createFromB58String(peerIdStr);
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
      this.logger.error("Removing unknown block", {
        root: block.blockRootHex,
        slot: block.status === PendingBlockStatus.toProcess ? block.signedBlock.message.slot : "toDownload",
      });
    }

    return badPendingBlocks;
  }
}
