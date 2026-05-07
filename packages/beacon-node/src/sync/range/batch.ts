import {ChainForkConfig} from "@lodestar/config";
import {ForkName, isForkPostDeneb, isForkPostFulu, isForkPostGloas} from "@lodestar/params";
import {Epoch, RootHex, SignedBeaconBlock, Slot, gloas, phase0} from "@lodestar/types";
import {LodestarError, byteArrayEquals, prettyPrintIndices, toRootHex} from "@lodestar/utils";
import {isBlockInputColumns} from "../../chain/blocks/blockInput/blockInput.js";
import {IBlockInput} from "../../chain/blocks/blockInput/types.js";
import {isDaOutOfRange} from "../../chain/blocks/blockInput/utils.js";
import {PayloadEnvelopeInput} from "../../chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";
import {BlockError, BlockErrorCode} from "../../chain/errors/index.js";
import {ZERO_HASH} from "../../constants/constants.js";
import {PeerSyncMeta} from "../../network/peers/peersData.js";
import {IClock} from "../../util/clock.js";
import {CustodyConfig} from "../../util/dataColumns.js";
import {PeerIdStr} from "../../util/peerId.js";
import {MAX_BATCH_DOWNLOAD_ATTEMPTS, MAX_BATCH_PROCESSING_ATTEMPTS} from "../constants.js";
import {DownloadByRangeRequests, ParentPayloadCommitments} from "../utils/downloadByRange.js";
import {getBatchSlotRange, hashBlocks} from "./utils/index.js";

/**
 * Current state of a batch
 */
export enum BatchStatus {
  /** The batch has failed either downloading or processing, but can be requested again. */
  AwaitingDownload = "AwaitingDownload",
  /** The batch is being downloaded. */
  Downloading = "Downloading",
  /** The batch has been completely downloaded and is ready for processing. */
  AwaitingProcessing = "AwaitingProcessing",
  /** The batch is being processed. */
  Processing = "Processing",
  /**
   * The batch was successfully processed and is waiting to be validated.
   *
   * It is not sufficient to process a batch successfully to consider it correct. This is
   * because batches could be erroneously empty, or incomplete. Therefore, a batch is considered
   * valid, only if the next sequential batch imports at least a block.
   */
  AwaitingValidation = "AwaitingValidation",
}

export type Attempt = {
  /** The peer that made the attempt */
  peers: PeerIdStr[];
  /** The hash of the blocks of the attempt */
  hash: RootHex;
};

export type AwaitingDownloadState = {
  status: BatchStatus.AwaitingDownload;
  blocks: IBlockInput[];
  payloadEnvelopes: Map<Slot, PayloadEnvelopeInput> | null;
};

export type DownloadSuccessState = {
  status: BatchStatus.AwaitingProcessing;
  blocks: IBlockInput[];
  payloadEnvelopes: Map<Slot, PayloadEnvelopeInput> | null;
};

export type BatchState =
  | AwaitingDownloadState
  | {
      status: BatchStatus.Downloading;
      peer: PeerIdStr;
      blocks: IBlockInput[];
      payloadEnvelopes: Map<Slot, PayloadEnvelopeInput> | null;
    }
  | DownloadSuccessState
  | {
      status: BatchStatus.Processing;
      blocks: IBlockInput[];
      payloadEnvelopes: Map<Slot, PayloadEnvelopeInput> | null;
      attempt: Attempt;
    }
  | {
      status: BatchStatus.AwaitingValidation;
      blocks: IBlockInput[];
      payloadEnvelopes: Map<Slot, PayloadEnvelopeInput> | null;
      attempt: Attempt;
    };

export type BatchMetadata = {
  // Batch-level slot window (always present)
  startEpoch: Epoch;
  startSlot: Slot;
  count: number;
  status: BatchStatus;

  // Per-type outstanding request shapes; only present when that sub-request exists.
  // Format: "startSlot=<n>,count=<n>" (plus ",cols=<indices>" for columns).
  blocksReq?: string;
  blobsReq?: string;
  columnsReq?: string;
  envelopesReq?: string;

  // Retry counters
  downloadAttempts: number;
  processingAttempts: number;

  // Cumulative peer attribution for failed attempts (only present when non-empty)
  failedDownloadPeers?: string;
  failedProcessingPeers?: string;
};

function formatRangeReq(req: {startSlot: Slot; count: number}): string {
  return `startSlot=${req.startSlot},count=${req.count}`;
}

function formatColumnsReq(req: {startSlot: Slot; count: number; columns: number[]}): string {
  return `startSlot=${req.startSlot},count=${req.count},cols=${prettyPrintIndices(req.columns)}`;
}

/**
 * Batches are downloaded at the first block of the epoch.
 *
 * For example:
 *
 * Epoch boundary |                                   |
 *  ... | 30 | 31 | 32 | 33 | 34 | ... | 61 | 62 | 63 | 64 | 65 |
 *     Batch 1    |              Batch 2              |  Batch 3
 *
 * Jul2022: Offset changed from 1 to 0, see rationale in {@link BATCH_SLOT_OFFSET}
 */
export class Batch {
  readonly forkName: ForkName;
  readonly startEpoch: Epoch;
  readonly startSlot: Slot;
  readonly count: number;

  /** Block, blob and column requests that are used to determine the best peer and are used in downloadByRange */
  requests: DownloadByRangeRequests;
  /** State of the batch. */
  state: BatchState = {status: BatchStatus.AwaitingDownload, blocks: [], payloadEnvelopes: null};
  /** Peers that provided good data */
  goodPeers: PeerIdStr[] = [];
  /** The `Attempts` that have been made and failed to send us this batch. */
  readonly failedProcessingAttempts: Attempt[] = [];
  /** The `Attempts` that have been made and failed because of execution malfunction. */
  readonly executionErrorAttempts: Attempt[] = [];
  /** The number of download retries this batch has undergone due to a failed request. */
  private readonly failedDownloadAttempts: PeerIdStr[] = [];
  private readonly config: ChainForkConfig;
  private readonly clock: IClock;
  private readonly custodyConfig: CustodyConfig;
  private readonly isFirstBatchInChain: boolean;
  private readonly latestBid: gloas.ExecutionPayloadBid | undefined;

  constructor(
    startEpoch: Epoch,
    config: ChainForkConfig,
    clock: IClock,
    custodyConfig: CustodyConfig,
    isFirstBatchInChain: boolean,
    latestBid: gloas.ExecutionPayloadBid | undefined,
    targetSlot: Slot
  ) {
    this.config = config;
    this.clock = clock;
    this.custodyConfig = custodyConfig;

    const {startSlot, count} = getBatchSlotRange(startEpoch);
    this.forkName = this.config.getForkName(startSlot);
    this.startEpoch = startEpoch;
    this.startSlot = startSlot;
    this.count = Math.min(count, targetSlot - startSlot + 1);
    this.isFirstBatchInChain = isFirstBatchInChain;
    this.latestBid = latestBid;
    this.requests = this.getRequests([]);
  }

  private shouldDownloadParentEnvelope(firstBlock?: SignedBeaconBlock): boolean {
    if (!this.isFirstBatchInChain) return false;

    if (this.startSlot === 0 || !isForkPostGloas(this.config.getForkName(this.startSlot - 1))) {
      return false;
    }

    // we only know if we should download parent envelope if firstBlock is downloaded
    if (firstBlock === undefined) return false;
    if (this.latestBid === undefined) return false;
    const firstBlockBidParentHash = (firstBlock.message.body as gloas.BeaconBlockBody).signedExecutionPayloadBid.message
      .parentBlockHash;
    return byteArrayEquals(firstBlockBidParentHash, this.latestBid.blockHash);
  }

  getParentPayloadCommitments(parentBlockRoot: Uint8Array): ParentPayloadCommitments {
    if (this.latestBid === undefined) {
      throw new Error(
        `Coding error: getParentPayloadCommitments called without latestBid for parentBlockRoot=${toRootHex(parentBlockRoot)}`
      );
    }
    return {
      blockRoot: parentBlockRoot,
      blockRootHex: toRootHex(parentBlockRoot),
      kzgCommitments: this.latestBid.blobKzgCommitments,
    };
  }

  /**
   * Builds ByRange requests for block, blobs and columns
   */
  private getRequests(blocks: IBlockInput[]): DownloadByRangeRequests {
    const withinValidRequestWindow = !isDaOutOfRange(
      this.config,
      this.forkName,
      this.startSlot,
      this.clock.currentEpoch
    );

    // fresh request where no blocks have started to be pulled yet
    if (!blocks.length) {
      const blocksRequest: phase0.BeaconBlocksByRangeRequest = {
        startSlot: this.startSlot,
        count: this.count,
        step: 1,
      };
      const requests: DownloadByRangeRequests = {blocksRequest};

      // Post-Gloas envelopes are required for block processing, independent of DA retention window.
      if (isForkPostGloas(this.forkName)) {
        requests.envelopesRequest = {startSlot: this.startSlot, count: this.count};
      }

      if (isForkPostFulu(this.forkName) && withinValidRequestWindow) {
        requests.columnsRequest = {
          startSlot: this.startSlot,
          count: this.count,
          columns: this.custodyConfig.sampledColumns,
        };
      } else if (isForkPostDeneb(this.forkName) && withinValidRequestWindow) {
        requests.blobsRequest = {startSlot: this.startSlot, count: this.count};
      }

      return requests;
    }

    // subsequent request where part of the epoch has already been downloaded. Need to figure out what is the beginning
    // of the range where download needs to resume
    let blockStartSlot = this.startSlot;
    let dataStartSlot = this.startSlot;
    let envelopeStartSlot = this.startSlot;
    const neededColumns = new Set<number>();
    const envelopesBySlot = this.state.payloadEnvelopes ?? new Map<Slot, PayloadEnvelopeInput>();

    // ensure blocks are in slot-wise order
    const isPostGloas = isForkPostGloas(this.forkName);
    for (const blockInput of blocks) {
      const blockSlot = blockInput.slot;
      // check if block/data is present (hasBlock/hasAllData). If present then check if startSlot is the same as
      // blockSlot. If it is then do not need to pull that slot so increment startSlot by 1. check will fail
      // if there is a gap and then the blocks/data is present again. to simplify the request just re-pull remainder
      // of range.
      //
      // ie startSlot = 32 and count = 32. so for slots = [32, 33, 34, 35, 36, _, 38, 39, _, _, ... _endSlot=63_]
      // will return an updated startSlot of 37 and pull range 37-63 on the next request.
      //
      // if all slot have already been pulled then the startSlot will eventually get incremented to the slot after
      // the desired end slot
      if (blockInput.hasBlock() && blockStartSlot === blockSlot) {
        blockStartSlot = blockSlot + 1;
      }

      // Range sync uses hasComputedAllData (all sampled columns physically present), not hasAllData
      // which flips at the reconstruction threshold. Sync never triggers reconstruction, so accepting
      // a half-downloaded block here makes writeBlockInputToDb later block on waitForComputedAllData.
      if (isPostGloas) {
        // Post-Gloas: column data lives on PayloadEnvelopeInput, not on BlockInputNoData.
        const payloadInput = envelopesBySlot.get(blockSlot);
        if (blockInput.hasBlock() && envelopeStartSlot === blockSlot && payloadInput?.hasPayloadEnvelope()) {
          envelopeStartSlot = blockSlot + 1;
        }
        if (payloadInput && !payloadInput.hasComputedAllData()) {
          for (const index of payloadInput.getMissingSampledColumnMeta().missing) {
            neededColumns.add(index);
          }
        } else if (payloadInput?.hasComputedAllData() && dataStartSlot === blockSlot) {
          // Only advance dataStartSlot when we know columns for this slot are complete. If
          // payloadInput is missing entirely we cannot tell, so stop here so the next round
          // re-requests columns (and envelopes) starting at this slot.
          dataStartSlot = blockSlot + 1;
        }
      } else {
        if (isBlockInputColumns(blockInput) ? !blockInput.hasComputedAllData() : !blockInput.hasAllData()) {
          if (isBlockInputColumns(blockInput)) {
            for (const index of blockInput.getMissingSampledColumnMeta().missing) {
              neededColumns.add(index);
            }
          }
        } else if (dataStartSlot === blockSlot) {
          dataStartSlot = blockSlot + 1;
        }
      }
    }

    // if the blockStartSlot or dataStartSlot is after the desired endSlot then no request will be made for the batch
    // because it is complete
    const endSlot = this.startSlot + this.count - 1;
    const requests: DownloadByRangeRequests = {};
    if (blockStartSlot <= endSlot) {
      requests.blocksRequest = {
        startSlot: blockStartSlot,
        // range of 40 - 63, startSlot will be inclusive but subtraction will exclusive so need to + 1
        count: endSlot - blockStartSlot + 1,
        step: 1,
      };
    }
    if (dataStartSlot <= endSlot) {
      // range of 40 - 63, startSlot will be inclusive but subtraction will exclusive so need to + 1
      const count = endSlot - dataStartSlot + 1;
      if (isForkPostFulu(this.forkName) && withinValidRequestWindow) {
        // Skip the column re-request when we have no specific column indices outstanding.
        // Peer rejects an empty `columns` list
        if (neededColumns.size > 0) {
          requests.columnsRequest = {
            count,
            startSlot: dataStartSlot,
            columns: Array.from(neededColumns),
          };
        }
      } else if (isForkPostDeneb(this.forkName) && withinValidRequestWindow) {
        requests.blobsRequest = {
          count,
          startSlot: dataStartSlot,
        };
      }
      // dataSlot will still have a value but do not create a request for preDeneb forks
    }

    if (isForkPostGloas(this.forkName) && envelopeStartSlot <= endSlot) {
      requests.envelopesRequest = {
        startSlot: envelopeStartSlot,
        count: endSlot - envelopeStartSlot + 1,
      };
    }

    // Only the first batch of a SyncChain may need the dangling-parent payload by-root.
    if (blocks.length > 0 && this.shouldDownloadParentEnvelope(blocks[0].getBlock())) {
      // shouldDownloadParentEnvelope() = true means there are at least 1 block
      const parentRoot = blocks[0].getBlock().message.parentRoot;
      if (!byteArrayEquals(parentRoot, ZERO_HASH)) {
        const parentRootHex = toRootHex(parentRoot);
        let parentPayloadInput: PayloadEnvelopeInput | undefined;
        if (this.state.payloadEnvelopes) {
          for (const pi of this.state.payloadEnvelopes.values()) {
            if (pi.blockRootHex === parentRootHex) {
              parentPayloadInput = pi;
              break;
            }
          }
        }

        const needsEnvelope = !parentPayloadInput?.hasPayloadEnvelope();
        const missingColumns = parentPayloadInput
          ? parentPayloadInput.getMissingSampledColumnMeta().missing
          : this.custodyConfig.sampledColumns;

        if (needsEnvelope || missingColumns.length > 0) {
          requests.parentPayloadRequest = {
            ...(needsEnvelope ? {envelopeBlockRoot: parentRoot} : {}),
            ...(missingColumns.length > 0 ? {blockRoot: parentRoot, columns: missingColumns} : {}),
          };
        }
      }
    }

    return requests;
  }

  /**
   * Post-fulu we should only get columns that peer has advertised
   */
  getRequestsForPeer(peer: PeerSyncMeta): DownloadByRangeRequests {
    if (!isForkPostFulu(this.forkName)) {
      return this.requests;
    }

    // post-fulu we need to ensure that we only request columns that the peer has advertised.
    const {columnsRequest, parentPayloadRequest} = this.requests;

    const peerColumns = new Set(peer.custodyColumns ?? []);
    const filteredColumnsRequest =
      columnsRequest != null ? columnsRequest.columns.filter((c) => peerColumns.has(c)) : null;
    const parentColumns = parentPayloadRequest?.columns;
    const filteredParentColumns = parentColumns != null ? parentColumns.filter((c) => peerColumns.has(c)) : null;

    const updatedColumnRequest =
      columnsRequest != null && filteredColumnsRequest != null
        ? {columnsRequest: {...columnsRequest, columns: filteredColumnsRequest}}
        : {};
    const updatedParentPayloadRequest =
      parentPayloadRequest != null && filteredParentColumns != null
        ? {parentPayloadRequest: {...parentPayloadRequest, columns: filteredParentColumns}}
        : {};

    return {
      ...this.requests,
      ...updatedColumnRequest,
      ...updatedParentPayloadRequest,
    };
  }

  /**
   * Gives a list of peers from which this batch has had a failed download or processing attempt.
   */
  getFailedPeers(): PeerIdStr[] {
    return [...this.failedDownloadAttempts, ...this.failedProcessingAttempts.flatMap((a) => a.peers)];
  }

  getMetadata(): BatchMetadata {
    const {blocksRequest, blobsRequest, columnsRequest, envelopesRequest} = this.requests;
    const failedProcessingPeerList = this.failedProcessingAttempts.flatMap((a) => a.peers);
    return {
      startEpoch: this.startEpoch,
      startSlot: this.startSlot,
      count: this.count,
      status: this.state.status,
      ...(blocksRequest && {blocksReq: formatRangeReq(blocksRequest)}),
      ...(blobsRequest && {blobsReq: formatRangeReq(blobsRequest)}),
      ...(columnsRequest && {columnsReq: formatColumnsReq(columnsRequest)}),
      ...(envelopesRequest && {envelopesReq: formatRangeReq(envelopesRequest)}),
      downloadAttempts: this.failedDownloadAttempts.length,
      processingAttempts: this.failedProcessingAttempts.length,
      ...(this.failedDownloadAttempts.length > 0 && {
        failedDownloadPeers: this.failedDownloadAttempts.join(","),
      }),
      ...(failedProcessingPeerList.length > 0 && {
        failedProcessingPeers: failedProcessingPeerList.join(","),
      }),
    };
  }

  getBlocks(): IBlockInput[] {
    return this.state.blocks;
  }

  getPayloadEnvelopes(): Map<Slot, PayloadEnvelopeInput> | null {
    return this.state.payloadEnvelopes;
  }

  /**
   * AwaitingDownload -> Downloading
   */
  startDownloading(peer: PeerIdStr): void {
    if (this.state.status !== BatchStatus.AwaitingDownload) {
      throw new BatchError(this.wrongStatusErrorType(BatchStatus.AwaitingDownload));
    }

    this.state = {
      status: BatchStatus.Downloading,
      peer,
      blocks: this.state.blocks,
      payloadEnvelopes: this.state.payloadEnvelopes,
    };
  }

  /**
   * Downloading -> AwaitingProcessing
   */
  downloadingSuccess(
    peer: PeerIdStr,
    blocks: IBlockInput[],
    payloadEnvelopes: Map<Slot, PayloadEnvelopeInput> | null
  ): DownloadSuccessState {
    if (this.state.status !== BatchStatus.Downloading) {
      throw new BatchError(this.wrongStatusErrorType(BatchStatus.Downloading));
    }

    // ensure that blocks are always sorted before getting stored on the batch.state or being used to getRequests
    blocks.sort((a, b) => a.slot - b.slot);

    this.goodPeers.push(peer);

    let allComplete = true;
    const slots = new Set<number>();
    for (const block of blocks) {
      slots.add(block.slot);
      const dataComplete = isBlockInputColumns(block)
        ? // by_range needs to download all columns
          block.hasBlock() && block.hasComputedAllData()
        : block.hasBlockAndAllData();
      if (!dataComplete) {
        allComplete = false;
      }
    }

    if (slots.size > this.count) {
      throw new BatchError({
        code: BatchErrorCode.INVALID_COUNT,
        startEpoch: this.startEpoch,
        count: slots.size,
        expected: this.count,
        status: this.state.status,
      });
    }
    const newPayloadEnvelopes = payloadEnvelopes ?? this.state.payloadEnvelopes;

    if (allComplete && isForkPostGloas(this.forkName)) {
      for (const block of blocks) {
        const payloadInput = newPayloadEnvelopes?.get(block.slot);
        // by_range needs every block's envelope and all sampled columns.
        if (!payloadInput?.hasPayloadEnvelope() || !payloadInput.hasComputedAllData()) {
          allComplete = false;
          break;
        }
      }
    }

    // First batch of a sync chain must additionally have the dangling-parent payload fully
    // present, otherwise `processBlocks` will throw PARENT_PAYLOAD_UNKNOWN. The parent's
    // `PayloadEnvelopeInput` is identified by `blockRootHex` matching `blocks[0].parentRoot`.
    if (allComplete && blocks.length > 0 && this.shouldDownloadParentEnvelope(blocks[0].getBlock())) {
      const parentRoot = blocks[0].getBlock().message.parentRoot;
      // Genesis has no parent payload — nothing to wait for.
      if (!byteArrayEquals(parentRoot, ZERO_HASH)) {
        const parentRootHex = toRootHex(parentRoot);
        let parentPayloadComplete = false;
        if (newPayloadEnvelopes) {
          for (const payloadInput of newPayloadEnvelopes.values()) {
            if (payloadInput.blockRootHex === parentRootHex) {
              parentPayloadComplete = payloadInput.hasPayloadEnvelope() && payloadInput.hasComputedAllData();
              break;
            }
          }
        }
        if (!parentPayloadComplete) {
          allComplete = false;
        }
      }
    }

    if (allComplete) {
      this.state = {status: BatchStatus.AwaitingProcessing, blocks, payloadEnvelopes: newPayloadEnvelopes};
    } else {
      this.state = {status: BatchStatus.AwaitingDownload, blocks, payloadEnvelopes: newPayloadEnvelopes};
      this.requests = this.getRequests(blocks);
    }

    return this.state as DownloadSuccessState;
  }

  /**
   * Downloading -> AwaitingDownload
   */
  downloadingError(peer: PeerIdStr): void {
    if (this.state.status !== BatchStatus.Downloading) {
      throw new BatchError(this.wrongStatusErrorType(BatchStatus.Downloading));
    }

    this.failedDownloadAttempts.push(peer);
    if (this.failedDownloadAttempts.length > MAX_BATCH_DOWNLOAD_ATTEMPTS) {
      throw new BatchError(this.errorType({code: BatchErrorCode.MAX_DOWNLOAD_ATTEMPTS}));
    }

    this.state = {
      status: BatchStatus.AwaitingDownload,
      blocks: this.state.blocks,
      payloadEnvelopes: this.state.payloadEnvelopes,
    };
  }

  /**
   * Downloading -> AwaitingDownload (without counting as a failed attempt).
   * Used when the peer rate-limited us — the request was never actually served.
   */
  downloadingRateLimited(): void {
    if (this.state.status !== BatchStatus.Downloading) {
      throw new BatchError(this.wrongStatusErrorType(BatchStatus.Downloading));
    }

    this.state = {
      status: BatchStatus.AwaitingDownload,
      blocks: this.state.blocks,
      payloadEnvelopes: this.state.payloadEnvelopes,
    };
  }

  /**
   * AwaitingProcessing -> Processing
   */
  startProcessing(): {
    blocks: IBlockInput[];
    payloadEnvelopes: Map<Slot, PayloadEnvelopeInput> | null;
    peers: PeerIdStr[];
  } {
    if (this.state.status !== BatchStatus.AwaitingProcessing) {
      throw new BatchError(this.wrongStatusErrorType(BatchStatus.AwaitingProcessing));
    }

    const blocks = this.state.blocks;
    const payloadEnvelopes = this.state.payloadEnvelopes;
    const hash = hashBlocks(blocks, this.config); // tracks blocks to report peer on processing error
    // Reset goodPeers in case another download attempt needs to be made.  When Attempt is successful or not the peers
    // that the data came from will be handled by the Attempt that goes for processing
    const peers = this.goodPeers;
    this.goodPeers = [];
    this.state = {status: BatchStatus.Processing, blocks, payloadEnvelopes, attempt: {peers, hash}};
    return {blocks, payloadEnvelopes, peers};
  }

  /**
   * Processing -> AwaitingValidation
   */
  processingSuccess(): void {
    if (this.state.status !== BatchStatus.Processing) {
      throw new BatchError(this.wrongStatusErrorType(BatchStatus.Processing));
    }

    this.state = {
      status: BatchStatus.AwaitingValidation,
      blocks: this.state.blocks,
      payloadEnvelopes: this.state.payloadEnvelopes,
      attempt: this.state.attempt,
    };
  }

  /**
   * Processing -> AwaitingDownload
   */
  processingError(err: Error): void {
    if (this.state.status !== BatchStatus.Processing) {
      throw new BatchError(this.wrongStatusErrorType(BatchStatus.Processing));
    }

    if (err instanceof BlockError && err.type.code === BlockErrorCode.EXECUTION_ENGINE_ERROR) {
      this.onExecutionEngineError(this.state.attempt);
    } else {
      this.onProcessingError(this.state.attempt);
    }
  }

  /**
   * AwaitingValidation -> AwaitingDownload
   */
  validationError(err: Error): void {
    if (this.state.status !== BatchStatus.AwaitingValidation) {
      throw new BatchError(this.wrongStatusErrorType(BatchStatus.AwaitingValidation));
    }

    if (err instanceof BlockError && err.type.code === BlockErrorCode.EXECUTION_ENGINE_ERROR) {
      this.onExecutionEngineError(this.state.attempt);
    } else {
      this.onProcessingError(this.state.attempt);
    }
  }

  /**
   * AwaitingValidation -> Done
   */
  validationSuccess(): Attempt {
    if (this.state.status !== BatchStatus.AwaitingValidation) {
      throw new BatchError(this.wrongStatusErrorType(BatchStatus.AwaitingValidation));
    }
    return this.state.attempt;
  }

  private onExecutionEngineError(attempt: Attempt): void {
    this.executionErrorAttempts.push(attempt);
    if (this.executionErrorAttempts.length > MAX_BATCH_PROCESSING_ATTEMPTS) {
      throw new BatchError(this.errorType({code: BatchErrorCode.MAX_EXECUTION_ENGINE_ERROR_ATTEMPTS}));
    }

    // remove any downloaded blocks and re-attempt
    // TODO(fulu): need to remove the bad blocks from the SeenBlockInputCache
    this.state = {status: BatchStatus.AwaitingDownload, blocks: [], payloadEnvelopes: null};
  }

  private onProcessingError(attempt: Attempt): void {
    this.failedProcessingAttempts.push(attempt);
    if (this.failedProcessingAttempts.length > MAX_BATCH_PROCESSING_ATTEMPTS) {
      throw new BatchError(this.errorType({code: BatchErrorCode.MAX_PROCESSING_ATTEMPTS}));
    }

    // remove any downloaded blocks and re-attempt
    // TODO(fulu): need to remove the bad blocks from the SeenBlockInputCache
    this.state = {status: BatchStatus.AwaitingDownload, blocks: [], payloadEnvelopes: null};
  }

  /** Helper to construct typed BatchError. Stack traces are correct as the error is thrown above */
  private errorType(type: BatchErrorType): BatchErrorType & BatchErrorMetadata {
    return {...type, startEpoch: this.startEpoch, status: this.state.status};
  }

  private wrongStatusErrorType(expectedStatus: BatchStatus): BatchErrorType & BatchErrorMetadata {
    return this.errorType({code: BatchErrorCode.WRONG_STATUS, expectedStatus});
  }
}

export enum BatchErrorCode {
  WRONG_STATUS = "BATCH_ERROR_WRONG_STATUS",
  INVALID_COUNT = "BATCH_ERROR_INVALID_COUNT",
  MAX_DOWNLOAD_ATTEMPTS = "BATCH_ERROR_MAX_DOWNLOAD_ATTEMPTS",
  MAX_PROCESSING_ATTEMPTS = "BATCH_ERROR_MAX_PROCESSING_ATTEMPTS",
  MAX_EXECUTION_ENGINE_ERROR_ATTEMPTS = "MAX_EXECUTION_ENGINE_ERROR_ATTEMPTS",
}

type BatchErrorType =
  | {code: BatchErrorCode.WRONG_STATUS; expectedStatus: BatchStatus}
  | {code: BatchErrorCode.INVALID_COUNT; count: number; expected: number}
  | {code: BatchErrorCode.MAX_DOWNLOAD_ATTEMPTS}
  | {code: BatchErrorCode.MAX_PROCESSING_ATTEMPTS}
  | {code: BatchErrorCode.MAX_EXECUTION_ENGINE_ERROR_ATTEMPTS};

type BatchErrorMetadata = {
  startEpoch: number;
  status: BatchStatus;
};

export class BatchError extends LodestarError<BatchErrorType & BatchErrorMetadata> {}
