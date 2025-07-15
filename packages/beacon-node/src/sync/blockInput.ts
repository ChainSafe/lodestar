import {ChainForkConfig} from "@lodestar/config";
import {
  ForkBlobs,
  ForkName,
  INTERVALS_PER_SLOT,
  isForkBlobs,
  isForkPostFulu,
  NUMBER_OF_COLUMNS,
} from "@lodestar/params";
import {ColumnIndex, Root, RootHex, SignedBeaconBlock, Slot, deneb} from "@lodestar/types";
import {BlobAndProof} from "@lodestar/types/deneb";
import {LodestarError, Logger, fromHex, pruneSetToMax, toHex, toRootHex} from "@lodestar/utils";
import {sleep} from "@lodestar/utils";
import {
  MissingBlob,
  BlockInput,
  BlockInputBlobs,
  BlockInputColumns,
  BlockInputSourceType,
  BlockInputType,
} from "../chain/blocks/utils/blockInput.js";
import {BlockError, BlockErrorCode} from "../chain/errors/index.js";
import {IBeaconChain} from "../chain/index.js";
import {Metrics} from "../metrics/index.js";
import {INetwork, NetworkEvent, NetworkEventData, PeerAction} from "../network/index.js";
// import {byteArrayEquals} from "../util/bytes.js";
import {PeerIdStr} from "../util/peerId.js";
// import {shuffle} from "../util/shuffle.js";
import {Result, wrapError} from "../util/wrapError.js";
import {SyncOptions} from "./options.js";
// import {UnknownAndAncestorBlocks} from "./interface.js";
import {computeInclusionProof} from "../util/blobs.js";
import {signedBlockToSignedHeader} from "@lodestar/state-transition";
import {shuffle} from "../util/shuffle.js";
import {PeerCustody} from "../util/dataColumns.js";
import {prettyPrintArray} from "./range/utils/downloadByRange.js";

/**
 * MAX_FETCHES_PER_SYNC_ATTEMPT should be set at, or below, MAX_REQUEST_BLOCKS_DENEB so we don't
 * get rate limited/baned by our peers. Setting at 2 allows for two retries on each PendingBlockInput
 * 2 attempts * 2 retries = 4 peer requests per ReqResp method
 */
const MAX_FETCHES_PER_SYNC_ATTEMPT = 2;
const MAX_RETRIES_PER_PENDING_BLOCK_INPUT = 2;

const MAX_ATTEMPTS_PER_BLOCK = 5;
const MAX_KNOWN_BAD_BLOCKS = 500;
const MAX_PENDING_BLOCKS = 100;

export enum PendingBlockInputStatus {
  pending = "pending",
  fetching = "fetching",
  downloaded = "downloaded",
  processing = "processing",
}

export type PendingBlockInput<BI extends BlockInput = BlockInput> = {
  status: PendingBlockInputStatus;
  blockInput: BI;
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

    const parentRoot = block.blockInput.getParentRootHex(false);

    /**
     * Have not attempted to fetch yet. Add to list for downloading
     * - or -
     * BlockInput was created from a rootHex and does not have data (with block header) or the block to know what the
     * parentRoot is.  Need to fetch both block and data and add parent to PendingBlocks when its known
     */
    if (block.status === PendingBlockInputStatus.pending || !parentRoot) {
      incomplete.push(block);
      continue;
    }

    /**
     * Block is ready to be processed.  Need to check fork choice to find out if parentRoot is known.  If it is
     * attempt to process the block, if not create an BlockInput by root hex for the block and add to the pending
     * blocks for download.
     */
    if (block.status === PendingBlockInputStatus.downloaded && !blocks.has(parentRoot)) {
      ancestors.push(block);
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
    const parentRoot = block.blockInput.getParentRootHex(false);
    if (parentRoot === blockRootHex) {
      descendantBlocks.push(block);
    }
  }
  return descendantBlocks;
}

enum BlockInputSyncErrorCode {
  UNKNOWN_PARENT_ROOT = "BLOCK_INPUT_SYNC_UNKNOWN_PARENT_ROOT",
  INCOMPLETE_BLOCK_INPUT = "BLOCK_INPUT_SYNC_INCOMPLETE_BLOCK_INPUT",
  INVALID_FORK = "BLOCK_INPUT_SYNC_INVALID_FORK",
  INCOMPLETE_DATA_FETCH = "BLOCK_INPUT_SYNC_INCOMPLETE_DATA_FETCH",
  FETCH_ERROR = "BLOCK_INPUT_SYNC_FETCH_ERROR",
  MAX_ATTEMPTS_PER_BLOCK = "BLOCK_INPUT_SYNC_MAX_ATTEMPTS_PER_BLOCK",
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
      forkName: ForkName;
    }
  | {
      code: BlockInputSyncErrorCode.INCOMPLETE_DATA_FETCH;
      peerId: string;
      blockRoot: RootHex;
      requested: number;
      received: number;
    }
  | {
      code: BlockInputSyncErrorCode.FETCH_ERROR;
      peerId: string;
      blockRoot: RootHex;
      slot: Slot | string;
    }
  | {
      code: BlockInputSyncErrorCode.MAX_ATTEMPTS_PER_BLOCK;
      blockRoot: RootHex;
      slot: Slot | string;
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
      metrics.syncBlockInput.pendingBlocks.addCollect(() =>
        metrics.syncBlockInput.pendingBlocks.set(this.pendingBlocks.size)
      );
      metrics.syncBlockInput.knownBadBlocks.addCollect(() =>
        metrics.syncBlockInput.knownBadBlocks.set(this.knownBadBlocks.size)
      );
    }
  }

  subscribeToNetwork(): void {
    if (!this.subscribedToNetworkEvents) {
      this.logger.verbose("BlockInputSync enabled.");
      this.network.events.on(NetworkEvent.blockInput, this.onBlockInput);
      this.network.events.on(NetworkEvent.unknownParent, this.onUnknownParent);
      this.network.events.on(NetworkEvent.peerConnected, this.triggerUnknownBlockSearch);
      this.subscribedToNetworkEvents = true;
    }
  }

  unsubscribeFromNetwork(): void {
    this.logger.verbose("BlockInputSync disabled.");
    this.network.events.off(NetworkEvent.blockInput, this.onBlockInput);
    this.network.events.off(NetworkEvent.unknownParent, this.onUnknownParent);
    this.network.events.off(NetworkEvent.peerConnected, this.triggerUnknownBlockSearch);
    this.subscribedToNetworkEvents = false;
  }

  close(): void {
    this.unsubscribeFromNetwork();
  }

  isSubscribedToNetwork(): boolean {
    return this.subscribedToNetworkEvents;
  }

  prune(rootHex: RootHex): void {
    let nextBlockInput: PendingBlockInput | undefined;
    do {
      nextBlockInput = this.pendingBlocks.get(rootHex);
      if (nextBlockInput) {
        const parentRootHex = nextBlockInput.blockInput.getParentRootHex();
        this.pendingBlocks.delete(nextBlockInput.blockInput.rootHex);
        nextBlockInput = this.pendingBlocks.get(parentRootHex);
      }
    } while (nextBlockInput);
  }

  /**
   * Process an blockInput event and register the blockInput in `pendingBlocks` Map.
   */
  private onBlockInput = (data: NetworkEventData[NetworkEvent.blockInput]): void => {
    try {
      const pendingBlockInput = this.addBlockInput(data.blockInput, data.peerIdStr);
      this.triggerUnknownBlockSearch();
      this.metrics?.syncBlockInput.onBlockInputStatus.inc({status: pendingBlockInput.blockInput.getDataStatus()});
      this.metrics?.syncBlockInput.onBlockInputSource.inc({source: data.source});
    } catch (e) {
      this.logger.debug("Error handling blockInput event", {}, e as Error);
    }
  };

  private onUnknownParent = (data: NetworkEventData[NetworkEvent.unknownParent]): void => {
    try {
      const {blockInput, source, peerIdStr} = data;
      const parentRootHex = blockInput.getParentRootHex();
      const parentBlockInput = this.chain.blockInputCache.getBlockInputByRootHex({rootHex: parentRootHex});
      // const pendingBlockInput =
      this.addBlockInput(parentBlockInput, peerIdStr);
      // const pendingParentBlockInput =
      this.addBlockInput(blockInput, peerIdStr);
      this.triggerUnknownBlockSearch();
      // this.metrics?.syncBlockInput.onBlockInputStatus.inc({status: pendingBlockInput.status});
      // this.metrics?.syncBlockInput.onBlockInputStatus.inc({status: pendingParentBlockInput.status});
      this.metrics?.syncBlockInput.onBlockInputSource.inc({source: source}, 2);
    } catch (e) {
      this.logger.debug("Error handling unknownParent event", {}, e as Error);
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

    const {incomplete, ancestors} = getIncompleteAndAncestorBlocks(this.pendingBlocks);

    let processedBlocks = 0;
    let newParentFound = 0;
    for (const block of ancestors) {
      const parentRoot = block.blockInput.getParentRootHex(false);
      if (!parentRoot) {
        // ancestors should all have a parentRoot otherwise they would have been put
        // in the incomplete array. Some kind of unknown error here, log it and move on
        this.logger.error(
          "Attempting to fetch ancestor with unknown parentRoot",
          {},
          new BlockInputSyncError({
            code: BlockInputSyncErrorCode.UNKNOWN_PARENT_ROOT,
            ...block.blockInput.getLogMeta(),
          })
        );
        continue;
      }

      if (this.chain.forkChoice.hasBlockHex(parentRoot)) {
        processedBlocks++;
        this.processBlock(block).catch((e) => {
          this.logger.debug("Unexpected error in BlockInputSync.processBlock", block.blockInput.getLogMeta(), e);
        });
      } else {
        newParentFound++;
        const blockInput = this.chain.blockInputCache.getBlockInputByRootHex({rootHex: parentRoot});
        incomplete.push(this.addBlockInput(blockInput));
      }
    }

    for (const block of incomplete) {
      this.downloadBlockInput(block).catch((e) => {
        this.logger.error("Unexpected error in BlockInputSync.downloadBlockInput", block.blockInput.getLogMeta(), e);
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
    if (pendingBlock.blockInput.isComplete()) {
      this.logger.error(
        "Attempting to process a blockInput that is incomplete",
        {},
        new BlockInputSyncError({
          code: BlockInputSyncErrorCode.INCOMPLETE_BLOCK_INPUT,
          ...pendingBlock.blockInput.getLogMeta(),
        })
      );
      return;
    }

    pendingBlock.status = PendingBlockInputStatus.processing;
    // this prevents unbundling attack
    // see https://lighthouse-blog.sigmaprime.io/mev-unbundling-rpc.html
    const {slot, proposerIndex} = pendingBlock.blockInput.getBlock().block.message;
    if (
      this.chain.clock.secFromSlot(slot) < this.proposerBoostSecWindow &&
      this.chain.seenBlockProposers.isKnown(slot, proposerIndex)
    ) {
      // proposer is known by a gossip block already, wait a bit to make sure this block is not
      // eligible for proposer boost to prevent unbundling attack
      this.logger.verbose("Avoid proposer boost for this block of known proposer", {
        ...pendingBlock.blockInput.getLogMeta(),
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
      this.pendingBlocks.delete(pendingBlock.blockInput.rootHex);

      // Send child blocks to the processor
      for (const descendantBlock of getDescendantBlocks(pendingBlock.blockInput.rootHex, this.pendingBlocks)) {
        this.processBlock(descendantBlock).catch((err) => {
          this.logger.error(
            "BlockInputSync unexpected error processing descendant block",
            descendantBlock.blockInput.getLogMeta(),
            err
          );
        });
      }

      return;
    }

    this.metrics?.syncBlockInput.processedBlocksError.inc();
    const errorData = pendingBlock.blockInput.getLogMeta();
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

  // TODO: (@matthewkeil) this function has bugs. need to make another pass and clean up
  private async downloadBlockInput(block: PendingBlockInput): Promise<void> {
    block.status = PendingBlockInputStatus.fetching;

    // If the node loses all peers with pending unknown blocks, the sync will stall
    let connectedPeers = this.network.getConnectedPeers();
    if (connectedPeers.length === 0) {
      this.logger.debug("No connected peers, skipping blockInput search");
      return;
    }
    connectedPeers = shuffle(connectedPeers);
    block.downloadAttempts++;

    const resolutions: Promise<void>[] = [];
    if (!block.blockInput.hasBlock()) {
      // const timer = this.metrics?.syncBlockInput.block.fetchBlockRequestTime.startTimer();
      resolutions.push(
        this.fetchBlock(block, connectedPeers)
          .then(() => {})
          .catch((err) => {
            block.status = PendingBlockInputStatus.pending;
            // this.metrics?.syncBlockInput.block.fetchBlockErrorCount.inc();
            this.logger.error("BlockInputSync.fetchBlock error", block.blockInput.getLogMeta(), err);
          })
        // .finally(() => {
        //   timer?.();
        // })
      );
    }

    if (block.blockInput.needData()) {
      // const timer = this.metrics?.syncBlockInput.data.fetchDataRequestTime.startTimer();
      resolutions.push(
        this.fetchData(block, connectedPeers)
          .then(() => {})
          .catch((err) => {
            block.status = PendingBlockInputStatus.pending;
            // this.metrics?.syncBlockInput.data.fetchDataErrorCount.inc({type: block.blockInput.type});
            this.logger.error("BlockInputSync.fetchData error", block.blockInput.getLogMeta(), err);
          })
        // .finally(() => {
        //   timer?.();
        // })
      );
    }

    await Promise.all(resolutions);

    if (
      (block.status as PendingBlockInputStatus) === PendingBlockInputStatus.pending &&
      block.downloadAttempts > MAX_ATTEMPTS_PER_BLOCK
    ) {
      this.logger.debug(
        `Ignoring fetch for blockInput after ${MAX_ATTEMPTS_PER_BLOCK} attempts`,
        block.blockInput.getLogMeta()
      );
      this.removeAndDownscoreAllDescendants(block);
      return;
    }

    if (!block.blockInput.isComplete()) {
      // BlockInput is incomplete, make sure it gets attempted again
      block.status = PendingBlockInputStatus.pending;
    } else {
      block.status = PendingBlockInputStatus.downloaded;
    }
  }

  private async fetchBlock(block: PendingBlockInput, peerIdStr: PeerIdStr): Promise<void> {
    // let attempt = 0;
    // for (const peerIdStr of connectedPeers) {
    //   if (attempt >= MAX_ATTEMPTS_PER_BLOCK) {
    //     throw new BlockInputSyncError({
    //       code: BlockInputSyncErrorCode.MAX_ATTEMPTS_PER_BLOCK,
    //       ...block.blockInput.getLogMeta(),
    //     });
    //   }

    // this.metrics?.syncBlockInput.block.fetchBlockRequestCount.inc();
    // try {
    const [fetched] = await this.network.sendBeaconBlocksByRoot(peerIdStr, [block.blockInput.blockRoot]);
    // this.metrics?.syncBlockInput.block.fetchBlockResponseCount.inc();
    const forkName = this.config.getForkName(fetched.data.message.slot);
    const blockRoot = this.config
      .getForkTypes(fetched.data.message.slot)
      .BeaconBlock.hashTreeRoot(fetched.data.message);
    const rootHex = toHex(blockRoot);
    block.blockInput.addBlock({
      forkName,
      rootHex,
      blockRoot,
      peerIdStr,
      block: fetched.data,
      source: BlockInputSourceType.byRoot,
      seenTimestampSec: Date.now(),
    });
    //   } catch (err) {
    //     if (err as Error) {
    //     }
    //   }

    //   attempt++;
    // }
  }

  private async fetchData(pendingBlockInput: PendingBlockInput, peerIdStr: PeerIdStr): Promise<void> {
    const forkName = pendingBlockInput.blockInput.getForkName();

    if (isForkBlobs(forkName)) {
      return this.fetchBlobs(pendingBlockInput, peerIdStr);
    }

    if (isForkPostFulu(forkName)) {
      return this.fetchColumns(pendingBlockInput, peerIdStr);
    }

    throw new BlockInputSyncError(
      {
        code: BlockInputSyncErrorCode.INVALID_FORK,
        forkName,
        ...pendingBlockInput.blockInput.getLogMeta(),
      },
      "Attempting to fetchData for an invalid fork"
    );
  }

  private async fetchBlobs(pendingBlockInput: PendingBlockInput<BlockInputBlobs>, peerIdStr: PeerIdStr): Promise<void> {
    const blockInput = pendingBlockInput.blockInput;
    const forkName = pendingBlockInput.blockInput.getForkName();

    if (blockInput.type !== BlockInputType.Blobs) {
      throw new BlockInputSyncError(
        {
          code: BlockInputSyncErrorCode.INVALID_FORK,
          forkName,
          ...pendingBlockInput.blockInput.getLogMeta(),
        },
        "Attempting to fetch blobs for an invalid fork"
      );
    }

    let neededBlobIdentifier = blockInput.getMissingBlobIndices();
    if (!neededBlobIdentifier) {
      await blockInput.waitForBlock(1000);
      neededBlobIdentifier = blockInput.getMissingBlobIndices() as MissingBlob[];
    }

    const blobsAndProofs = await this.chain.executionEngine.getBlobs(
      forkName,
      neededBlobIdentifier.map(({versionHash}) => versionHash)
    );

    if (blobsAndProofs.filter((res) => res !== null).length) {
      const {block} = blockInput.getBlock();
      const signedBlockHeader = signedBlockToSignedHeader(this.config, block);
      for (const [requestIndex, maybeBlobAndProof] of blobsAndProofs.entries()) {
        if (maybeBlobAndProof) {
          const {blob, proof} = maybeBlobAndProof;
          const index = neededBlobIdentifier[requestIndex].index;
          blockInput.addBlobSidecar({
            blobSidecar: {
              blob,
              index,
              kzgCommitment: block.message.body.blobKzgCommitments[index],
              kzgProof: proof,
              signedBlockHeader,
              kzgCommitmentInclusionProof: computeInclusionProof(forkName, block.message.body, index),
            },
            // TODO: (@matthewkeil) calculate rootHex for header in sidecar
            rootHex: "",
            seenTimestampSec: Date.now(),
            source: BlockInputSourceType.engine,
            peerIdStr,
          });

          // TODO: (@matthewkeil) figure out a way to signal that it was found before pulling from reqresp
          neededBlobIdentifier[requestIndex] = undefined;
        }
      }
    }

    // remove needed indices that were filled by the engine
    neededBlobIdentifier = neededBlobIdentifier.filter((req) => req !== null);

    const blobs = await this.network.sendBlobSidecarsByRoot(peerIdStr, neededBlobIdentifier);
    for (const blobSidecar of blobs) {
      blockInput.addBlobSidecar({
        // TODO: (@matthewkeil) calculate rootHex for header in sidecar
        rootHex: "",
        peerIdStr,
        blobSidecar,
        seenTimestampSec: Date.now(),
        source: BlockInputSourceType.byRoot,
      });
    }

    if (blobs.length !== neededBlobIdentifier.length) {
      throw new BlockInputSyncError(
        {
          code: BlockInputSyncErrorCode.INCOMPLETE_DATA_FETCH,
          peerId: peerIdStr,
          blockRoot: blockInput.rootHex,
          requested: neededBlobIdentifier.length,
          received: blobs.length,
        },
        "Not all blobs requested were received"
      );
    }
  }

  /**
   * Attempt to fetch the columns in the most efficient way possible.  Given the following requirement:
   * missingColumns = [2, 4, 6, 8, 10, 12, 14]
   *
   * We want to first pull from the peer that has the most overlap with what is needed via what
   * getPeersWithBestCustody(missingColumns) returns:
   * [
   *    {peerIdStr: 0x1234, columns: [2, 6, 10, 12]},
   *    {peerIdStr: 0x2345, columns: [4, 6, 8, 14]},
   *    {peerIdStr: 0x3456, columns: [2, 4, 6]},
   *    {peerIdStr: 0x4567, columns: [6, 14]},
   *    {peerIdStr: 0x5678, columns: [10]},
   * ]
   *
   * Loop through those peers to get a connection and valid response.  Assume 0x1234 serves a valid but
   * partial response of columns [2, 6, 10].  Assume that peer has not yet seen column 12 so cannot serve
   * it.
   *
   * The next call to blockInput.getMissingColumnIndices returns:
   * missingColumns = [4, 8, 12, 14]
   *
   * the next call to getPeersWithBestCustody(missingColumns) returns:
   * [
   *    {peerIdStr: 0x2345, columns: [4, 8, 14]},
   *    {peerIdStr: 0x3456, columns: [2, 4]},
   *    {peerIdStr: 0x4567, columns: [6, 14]},
   *    {peerIdStr: 0x1234, columns: [12]},
   * ]
   *
   * Loops through in this fashion until either max attempts per peer or all the columns were received
   */
  private async fetchColumns(pendingBlockInput: PendingBlockInput<BlockInputColumns>): Promise<void> {
    const blockInput = pendingBlockInput.blockInput;
    if (blockInput.type !== BlockInputType.Columns) {
      throw new BlockInputSyncError(
        {
          code: BlockInputSyncErrorCode.INVALID_FORK,
          forkName: pendingBlockInput.blockInput.getForkName(),
          ...pendingBlockInput.blockInput.getLogMeta(),
        },
        "Attempting to fetch columns for an invalid fork"
      );
    }

    let attempts = 0;
    // the the missing indices for columns that we need
    let missingColumns = blockInput.getMissingColumnIndices();
    // loop while we are missing columns or until we reach the max number of attempts for this round
    while (missingColumns?.length && attempts < MAX_FETCHES_PER_SYNC_ATTEMPT) {
      attempts++;
      // always attempt to pull from a peer that has the most number of columns that we need
      const sorted = this.getPeersWithBestCustody(missingColumns.map(({index}) => index));
      for (const {peerIdStr, columns} of sorted) {
        try {
          await this.fetchColumn(blockInput, columns, peerIdStr);
          missingColumns = blockInput.getMissingColumnIndices();
        } catch {
          break;
        }
      }
    }
  }

  private getPeersWithBestCustody(missingColumns: ColumnIndex[]): {peerIdStr: string; columns: ColumnIndex[]}[] {
    const peers = new Map<string, number[]>();
    for (const columnIndex of missingColumns) {
      const peersWithCustody = this.network.getPeersWithCustody(columnIndex);
      for (const {peerIdStr} of peersWithCustody) {
        let custody = peers.get(peerIdStr);
        if (!custody) custody = [];
        custody.push(columnIndex);
        peers.set(peerIdStr, custody);
      }
    }

    return Array.from(peers.entries())
      .map(([peerIdStr, columns]) => ({peerIdStr, columns}))
      .sort((a, b) => a.columns.length - b.columns.length);
  }

  private async fetchColumn(
    blockInput: BlockInputColumns,
    requestedColumns: ColumnIndex[],
    peerIdStr: PeerIdStr
  ): Promise<void> {
    const columns = await this.network.sendDataColumnSidecarsByRoot(
      peerIdStr,
      requestedColumns.map((index) => ({index, blockRoot: blockInput.blockRoot}))
    );

    for (const columnSidecar of columns) {
      blockInput.addColumnSidecar({
        rootHex: blockInput.rootHex,
        columnSidecar,
        peerIdStr,
        seenTimestampSec: Date.now(),
        source: BlockInputSourceType.byRoot,
      });
    }

    if (columns.length !== requestedColumns.length) {
      const indexesReceived = columns.map(({index}) => index);
      const missingColumns = requestedColumns.filter((index) => !indexesReceived.includes(index));
      this.logger.debug("Peer did not respond with all data in BlockInputSync.fetchColumns", {
        peerIdStr,
        missingColumns: prettyPrintArray(missingColumns),
        requested: requestedColumns.length,
        received: columns.length,
      });
    }
  }

  private removeAllDescendants(pendingBlock: PendingBlockInput): void {}

  private removeAndDownscoreAllDescendants(pendingBlock: PendingBlockInput): void {}
}
