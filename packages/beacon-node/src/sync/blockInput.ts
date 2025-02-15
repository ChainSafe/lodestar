import {ChainForkConfig} from "@lodestar/config";
import {ForkName, INTERVALS_PER_SLOT, isForkBlobs, isForkPostFulu, NUMBER_OF_COLUMNS} from "@lodestar/params";
import {Root, RootHex, Slot, deneb} from "@lodestar/types";
import {BlobAndProof} from "@lodestar/types/deneb";
import {LodestarError, Logger, fromHex, pruneSetToMax, toRootHex} from "@lodestar/utils";
import {sleep} from "@lodestar/utils";
import {
  BlockInput,
  BlockInputBlobs,
  BlockInputColumns,
  BlockInputStatus,
  BlockInputType,
} from "../chain/blocks/utils/blockInput.js";
import {BlockError, BlockErrorCode} from "../chain/errors/index.js";
import {IBeaconChain} from "../chain/index.js";
import {Metrics} from "../metrics/index.js";
import {INetwork, NetworkEvent, NetworkEventData, PeerAction} from "../network/index.js";
import {
  beaconBlocksMaybeBlobsByRoot,
  unavailableBeaconBlobsByRoot,
} from "../network/reqresp/beaconBlocksMaybeBlobsByRoot.js";
// import {byteArrayEquals} from "../util/bytes.js";
import {PeerIdStr} from "../util/peerId.js";
// import {shuffle} from "../util/shuffle.js";
import {Result, wrapError} from "../util/wrapError.js";
import {SyncOptions} from "./options.js";
import {UnknownAndAncestorBlocks} from "./interface.js";

const MAX_ATTEMPTS_PER_BLOCK = 5;
const MAX_KNOWN_BAD_BLOCKS = 500;
const MAX_PENDING_BLOCKS = 100;

export enum PendingBlockInputStatus {
  pending = "pending",
  fetching = "fetching",
  downloaded = "downloaded",
  processing = "processing",
}

export type PendingBlockInput = {
  status: PendingBlockInputStatus;
  blockInput: BlockInput;
  peerIdStrings: Set<string>;
  downloadAttempts: number;
};

export type IncompleteAndAncestorBlocks = {
  incomplete: PendingBlockInput[];
  ancestors: PendingBlockInput[];
};

/**
 * Need to figure out what to pull next.  We will select:
 * - unknown blocks, ones that we have only seen the root hex of somewhere (gossip attestation,
 *   parentBlockRoot of a block we have seen, etc)
 * - incomplete blockInput, ones were either data or block are missing
 * - ancestor blocks, potentially blocks that are oldest in a chain of blocks to process and that
 *   might have a parentRoot that fork choice knows about
 *
 * Given this chain segment unknown block n => incomplete block n + 1 => downloaded block n + 2
 *   return {ancestors: [], incomplete: [n + 1]}
 *
 * Given this chain segment: downloaded block n => downloaded block n + 1 => downloaded block n + 2
 *   return {ancestors: [n], incomplete: []}
 *
 * Given this chain segment: incomplete block n => incomplete block n + 1 => downloaded block n + 2
 *   returns {ancestors: [], incomplete: [n, n + 1]}
 */
export function getIncompleteAndAncestorBlocks(blocks: Map<RootHex, PendingBlockInput>): IncompleteAndAncestorBlocks {
  const incomplete: PendingBlockInput[] = [];
  const ancestors: PendingBlockInput[] = [];

  for (const block of blocks.values()) {
    // Request for block and data has already been sent to the pipeline but response has not come back yet
    if (block.status === PendingBlockInputStatus.fetching) {
      continue;
    }

    const parentRoot = block.blockInput.parentRootHex;

    // TODO: remove this case if not needed
    /**
     * BlockInput was created from a rootHex and does not have data (with block header) or the block to know what the
     * parentRoot is.  Have not attempted to get block yet either so its not in-transit.  Need to fetch both block
     * and data and add parent to PendingBlocks when its known
     */
    // if (block.status === PendingBlockInputStatus.pending && !parentRoot) {
    //   incomplete.push(incomplete);
    //   continue;
    // }

    /**
     * Have not attempted to fetch yet. Add to list for downloading
     */
    if (block.status === PendingBlockInputStatus.pending) {
      incomplete.push(incomplete);
      continue;
    }

    /**
     * Block is ready to be processed.  Need to check fork choice to find out if parentRoot is known.  If it is
     * attempt to process the block, if not create an BlockInput by root hex for the block and add to the pending
     * blocks for download.
     */
    if (block.status === PendingBlockInputStatus.downloaded && !blocks.has(parentRoot)) {
      ancestors.push(ancestor);
    }

    /**
     * blocks here are either being processed or in the middle of a sync chain and not ready to be processed because
     * the ancestor block, with parent root that is known to fork choice, has not been found yet
     */
  }

  return {
    incomplete,
    ancestors,
  };
}

export function getDescendantBlocks(
  blockRootHex: RootHex,
  blocks: Map<RootHex, PendingBlockInput>
): PendingBlockInput[] {
  const descendantBlocks: PendingBlockInput[] = [];
  for (const block of blocks.values()) {
    if (block.blockInput.parentRootHex === blockRootHex) {
      descendantBlocks.push(block);
    }
  }
  return descendantBlocks;
}

enum BlockInputSyncErrorCode {
  UNKNOWN_PARENT_ROOT = "BLOCK_INPUT_SYNC_UNKNOWN_PARENT_ROOT",
  INCOMPLETE_BLOCK_INPUT = "BLOCK_INPUT_SYNC_INCOMPLETE_BLOCK_INPUT",
  INVALID_FORK = "BLOCK_INPUT_SYNC_INVALID_FORK",
}
type BlockInputSyncErrorType =
  | {
      code: BlockInputSyncErrorCode.UNKNOWN_PARENT_ROOT;
      blockRoot: RootHex;
      slot: Slot | string;
    }
  | {
      code: BlockInputSyncErrorCode.INCOMPLETE_BLOCK_INPUT;
      blockRoot: RootHex;
      slot: Slot | string;
    }
  | {
      code: BlockInputSyncErrorCode.INVALID_FORK;
      blockRoot: RootHex;
      slot: Slot | string;
      fork: ForkName;
    };

class BlockInputSyncError extends LodestarError<BlockInputSyncErrorType> {}

export class BlockInputSync {
  /**
   * block RootHex -> PendingBlock. To avoid finding same root at the same time
   */
  private readonly pendingBlocks = new Map<RootHex, PendingBlockInput>();
  private readonly knownBadBlocks = new Set<RootHex>();
  private readonly proposerBoostSecWindow: number;
  private readonly maxPendingBlocks;
  private subscribedToNetworkEvents = false;

  private engineGetBlobsCache = new Map<RootHex, BlobAndProof | null>();
  private blockInputsRetryTrackerCache = new Set<RootHex>();

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
    if (!this.subscribedToNetworkEvents) {
      this.logger.verbose("BlockInputSync enabled.");
      this.network.events.on(NetworkEvent.blockInput, this.onBlockInput);
      this.network.events.on(NetworkEvent.peerConnected, this.triggerUnknownBlockSearch);
      this.subscribedToNetworkEvents = true;
    }
  }

  unsubscribeFromNetwork(): void {
    this.logger.verbose("BlockInputSync disabled.");
    this.network.events.off(NetworkEvent.blockInput, this.onBlockInput);
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
      const pendingBlockInput = this.addBlockInput(data.blockInput, data.peerIdStr);
      this.triggerUnknownBlockSearch();
      this.metrics?.syncBlockInput.requests.inc({status: pendingBlockInput.blockInput.status});
    } catch (e) {
      this.logger.debug("Error handling blockInput event", {}, e as Error);
    }
  };

  private addBlockInput(blockInput: BlockInput, peerIdStr?: string): PendingBlockInput {
    let pendingBlock = this.pendingBlocks.get(blockInput.rootHex);
    if (!pendingBlock) {
      pendingBlock = {
        status: PendingBlockInputStatus.pending,
        blockInput,
        peerIdStrings: new Set(),
        downloadAttempts: 0,
      } as PendingBlockInput;
      this.pendingBlocks.set(blockInput.rootHex, pendingBlock);

      this.logger.verbose("Added blockInput to BlockInputSync.pendingBlocks", {
        unknownBlockType: pendingBlock?.unknownBlockType,
        root: blockInput.rootHex,
        slot: blockInput.slot ?? "unknown",
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
      this.logger.debug("No connected peers, skipping blockInput search");
      return;
    }

    const {incomplete, ancestors} = getIncompleteAndAncestorBlocks(this.pendingBlocks);

    let processedBlocks = 0;
    let newParentFound = 0;
    for (const block of ancestors) {
      const parentRoot = block.blockInput.parentRootHex;
      if (!parentRoot) {
        this.logger.error(
          "Attempting to process block with unknown parentRoot",
          {},
          new BlockInputSyncError({
            code: BlockInputSyncErrorCode.UNKNOWN_PARENT_ROOT,
            blockRoot: block.blockInput.rootHex,
            slot: block.blockInput.slot ?? "unknown",
          })
        );
        continue;
      }

      if (this.chain.forkChoice.hasBlockHex(parentRoot)) {
        processedBlocks++;
        this.processBlock(block).catch((e) => {
          this.logger.debug("Unexpected error - process old downloaded block", {}, e);
        });
      } else {
        newParentFound++;
        const blockInput = this.chain.blockInputCache.getBlockInputByRootHex(block.blockInput.parentRootHex);
        incomplete.push(this.addBlockInput(blockInput));
      }
    }

    for (const block of incomplete) {
      this.downloadBlockInput(block, connectedPeers).catch((e) => {
        this.logger.error("Unexpected error in BlockInputSync.downloadBlock", {root: block.blockInput.rootHex}, e);
      });
    }

    this.logger.verbose("BlockInputSync.triggerUnknownBlockSearch", {
      pendingBlocks: this.pendingBlocks.size,
      incompleteBlocks: incomplete.length,
      ancestorBlocks: ancestors.length,
      processedBlocks,
      newParentFound,
    });
  };

  /**
   * Send block to the processor awaiting completion. If processed successfully, send all children to the processor.
   * On error, remove and down-score all descendants.
   */
  private async processBlock(pendingBlock: PendingBlockInput): Promise<void> {
    if (pendingBlock.blockInput.status !== BlockInputStatus.COMPLETE) {
      this.logger.error(
        "Attempting to process a blockInput that is incomplete",
        {},
        new BlockInputSyncError({
          code: BlockInputSyncErrorCode.INCOMPLETE_BLOCK_INPUT,
          ...pendingBlock.blockInput.getLogMetaBasic(),
        })
      );
      return;
    }

    pendingBlock.status = PendingBlockInputStatus.processing;
    // this prevents unbundling attack
    // see https://lighthouse-blog.sigmaprime.io/mev-unbundling-rpc.html
    const {slot, proposerIndex} = pendingBlock.blockInput.block.message;
    if (
      this.chain.clock.secFromSlot(slot) < this.proposerBoostSecWindow &&
      this.chain.seenBlockProposers.isKnown(slot, proposerIndex)
    ) {
      // proposer is known by a gossip block already, wait a bit to make sure this block is not
      // eligible for proposer boost to prevent unbundling attack
      this.logger.verbose("Avoid proposer boost for this block of known proposer", {
        ...pendingBlock.blockInput.getLogMetaBasic(),
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

    if (!res.err) {
      this.metrics?.syncBlockInput.processedBlocksSuccess.inc();
      // no need to update status to "processed", delete anyway
      this.pendingBlocks.delete(pendingBlock.blockRootHex);

      // Send child blocks to the processor
      for (const descendantBlock of getDescendantBlocks(pendingBlock.blockRootHex, this.pendingBlocks)) {
        this.processBlock(descendantBlock).catch((err) => {
          this.logger.error(
            "BlockInputSync unexpected error processing descendant block",
            descendantBlock.blockInput.getLogMetaBasic(),
            err
          );
        });
      }

      return;
    }

    this.metrics?.syncBlockInput.processedBlocksError.inc();
    const errorData = pendingBlock.blockInput.getLogMetaBasic();
    if (res.err instanceof BlockError) {
      switch (res.err.type.code) {
        // This cases are already handled with `{ignoreIfKnown: true}`
        // case BlockErrorCode.ALREADY_KNOWN:
        // case BlockErrorCode.GENESIS_BLOCK:

        case BlockErrorCode.PARENT_UNKNOWN:
        case BlockErrorCode.PRESTATE_MISSING:
          // Should not happen, mark as downloaded to try again latter
          this.logger.error("Attempted to process block but its parent was still unknown", errorData, res.err);
          pendingBlock.status = PendingBlockInputStatus.downloaded;
          break;

        case BlockErrorCode.EXECUTION_ENGINE_ERROR:
          // Removing the block(s) without penalizing the peers, hoping for EL to
          // recover on a latter download + verify attempt
          this.removeAllDescendants(pendingBlock);
          break;

        default:
          // Block is not correct with respect to our chain. Log error loudly
          this.logger.debug("Error processing block from block input parent sync", errorData, res.err);
          this.removeAndDownscoreAllDescendants(pendingBlock);
      }
      return;
    }

    // Probably a queue error or something unwanted happened, mark as pending to try again latter
    this.logger.debug("Unknown error processing block from block input sync", errorData, res.err);
    pendingBlock.status = PendingBlockInputStatus.downloaded;
  }

  private async downloadBlockInput(block: PendingBlockInput, allPeers: PeerIdStr[]): Promise<void> {
    block.status = PendingBlockInputStatus.fetching;

    let blockResponse: Result<BlockInput>;
    if (block.blockInput.needBlock()) {
      blockResponse = await wrapError(this.fetchBlock());
    }

    let dataResponse: Result<BlockInput>;
    if (block.blockInput.needData()) {
      dataResponse = await wrapError(this.fetchData());
    }
  }

  private async fetchBlock(block: PendingBlockInput, allPeers: PeerIdStr[]): Promise<void> {}

  private async fetchData(block: PendingBlockInput, allPeers: PeerIdStr[]): Promise<void> {
    const peerId = "";

    if (isForkBlobs(block.blockInput.forkName)) {
      const blockInput = block.blockInput as BlockInputBlobs;
      if (blockInput.type !== BlockInputType.Blobs) {
        throw new BlockInputSyncError("Attempting to fetch blobs for an invalid fork", {
          code: BlockInputSyncErrorCode.INVALID_FORK,
          fork: `${block.blockInput.forkName}`,
          ...block.blockInput.getLogMetaBasic(),
        });
      }

      let neededBlobIndices = blockInput.getNeededBlobIndices();
      if (!neededBlobIndices) {
        await blockInput.waitForBlock();
        neededBlobIndices = blockInput.getNeededBlobIndices() as number[];
      }

      const blobs = await this.network.sendBlobSidecarsByRoot(
        peerId,
        neededBlobIndices.map((index) => ({index, blockRoot: blockInput.blockRoot}))
      );

      for (const blob of blobs) {
        blockInput.addBlob(blob);
      }

      return;
    }

    if (isForkPostFulu(block.blockInput.forkName)) {
      const blockInput = block.blockInput as BlockInputColumns;
      if (blockInput.type !== BlockInputType.Columns) {
        throw new BlockInputSyncError("Attempting to fetch columns for an invalid fork", {
          code: BlockInputSyncErrorCode.INVALID_FORK,
          fork: `${block.blockInput.forkName}`,
          ...block.blockInput.getLogMetaBasic(),
        });
      }

      const columns = await this.network.sendDataColumnSidecarsByRoot(
        peerId,
        blockInput.getNeededColumnIndices().map((index) => ({index, blockRoot: blockInput.blockRoot}))
      );

      for (const column of columns) {
        blockInput.addColumnSidecar(column);
      }

      return;
    }

    throw new BlockInputSyncError("Attempting to fetchData for an invalid fork", {
      code: BlockInputSyncErrorCode.INVALID_FORK,
      fork: `${block.blockInput.forkName}`,
      ...block.blockInput.getLogMetaBasic(),
    });
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
  ): Promise<{blockInput: BlockInput; peerIdStr: string}> {
    const shuffledPeers = shuffle(connectedPeers);
    const blockRootHex = toRootHex(blockRoot);

    let lastError: Error | null = null;
    let partialDownload = null;
    let fetchedPeerId = null;
    // TODO: should it be loop through MAX_ATTEMPTS_PER_BLOCK instead?
    for (let i = 0; i < 1; i++) {
      const peer = shuffledPeers[i % shuffledPeers.length];
      if (partialDownload !== null) {
        const [prevBlockInput] = partialDownload.blocks;
        if (prevBlockInput === undefined || prevBlockInput.type !== BlockInputType.dataPromise) {
          throw Error(`prevBlockInput=${prevBlockInput?.type} in partialDownload`);
        }
        const {cachedData} = prevBlockInput;
        if (cachedData.fork === ForkName.fulu) {
          const {dataColumnsCache} = cachedData as CachedDataColumns;
          const {custodyConfig} = this.network;
          const neededColumns = custodyConfig.sampledColumns.reduce((acc, elem) => {
            if (dataColumnsCache.get(elem) === undefined) {
              acc.push(elem);
            }
            return acc;
          }, [] as number[]);
          const peerColumns = this.network.getConnectedPeerCustody(peer);
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
        const peerClient = this.network.getConnectedPeerClientAgent(peer);
        const {
          blocks: [blockInput],
          pendingDataColumns,
        } = await beaconBlocksMaybeBlobsByRoot(
          this.config,
          this.network,
          peer,
          [blockRoot],
          partialDownload,
          peerClient,
          this.logger
        );

        // Peer does not have the block, try with next peer
        if (blockInput === undefined) {
          continue;
        }

        if (pendingDataColumns !== null) {
          partialDownload = {blocks: [blockInput], pendingDataColumns};
          fetchedPeerId = peer;
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
        const pendingColumns =
          this.network.custodyConfig.sampledColumns.length - (cachedData as CachedDataColumns).dataColumnsCache.size;
        Object.assign(dataMeta, {pendingColumns});
      }
    }

    let lastError: Error | null = null;
    for (let i = 0; i < MAX_ATTEMPTS_PER_BLOCK; i++) {
      const peer = shuffledPeers[i % shuffledPeers.length];
      if (unavailableBlockInput.block !== null) {
        const {cachedData} = unavailableBlockInput;
        if (cachedData.fork === ForkName.fulu) {
          const {dataColumnsCache} = cachedData as CachedDataColumns;
          const {custodyConfig} = this.network;
          const neededColumns = custodyConfig.sampledColumns.reduce((acc, elem) => {
            if (dataColumnsCache.get(elem) === undefined) {
              acc.push(elem);
            }
            return acc;
          }, [] as number[]);
          const peerColumns = this.network.getConnectedPeerCustody(peer);
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
        const peerClient = this.network.getConnectedPeerClientAgent(peer);
        const blockInput = await unavailableBeaconBlobsByRoot(
          this.config,
          this.network,
          peer,
          peerClient,
          unavailableBlockInput,
          {
            metrics: this.metrics,
            logger: this.logger,
            executionEngine: this.chain.executionEngine,
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
}
