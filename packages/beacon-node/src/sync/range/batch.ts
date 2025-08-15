import {ChainForkConfig} from "@lodestar/config";
import {ForkName, ForkSeq, isForkPostDeneb, isForkPostFulu} from "@lodestar/params";
import {Epoch, RootHex, Slot, deneb, fulu, phase0} from "@lodestar/types";
import {LodestarError} from "@lodestar/utils";
import {isBlockInputColumns} from "../../chain/blocks/blockInput/blockInput.js";
import {IBlockInput} from "../../chain/blocks/blockInput/types.js";
import {BlockError, BlockErrorCode} from "../../chain/errors/index.js";
import {PartialDownload} from "../../network/reqresp/beaconBlocksMaybeBlobsByRange.js";
import {PeerIdStr} from "../../util/peerId.js";
import {MAX_BATCH_DOWNLOAD_ATTEMPTS, MAX_BATCH_PROCESSING_ATTEMPTS} from "../constants.js";
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

export type BatchState =
  | {status: BatchStatus.AwaitingDownload; blocks?: IBlockInput[]}
  | {status: BatchStatus.Downloading; peer: PeerIdStr; blocks: IBlockInput[]}
  | {status: BatchStatus.AwaitingProcessing; blocks: IBlockInput[]}
  | {status: BatchStatus.Processing; attempt: Attempt}
  | {status: BatchStatus.AwaitingValidation; attempt: Attempt};

export type BatchMetadata = {
  startEpoch: Epoch;
  status: BatchStatus;
};

export type DownloadSuccessOutput =
  | {
      status: BatchStatus.AwaitingProcessing;
      blocks: IBlockInput[];
    }
  | {
      status: BatchStatus.AwaitingDownload;
      blocks: IBlockInput[];
    };

export type BatchRequests = {
  blocksRequest?: phase0.BeaconBlocksByRangeRequest;
  blobsRequest?: deneb.BlobSidecarsByRangeRequest;
  columnsRequest?: fulu.DataColumnSidecarsByRangeRequest;
};

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
  readonly requests: BatchRequests;

  /** State of the batch. */
  state: BatchState = {status: BatchStatus.AwaitingDownload};
  /** Peers that provided good data */
  readonly goodPeers: PeerIdStr[] = [];
  /** The `Attempts` that have been made and failed to send us this batch. */
  readonly failedProcessingAttempts: Attempt[] = [];
  /** The `Attempts` that have been made and failed because of execution malfunction. */
  readonly executionErrorAttempts: Attempt[] = [];
  /** The number of download retries this batch has undergone due to a failed request. */
  private readonly failedDownloadAttempts: PeerIdStr[] = [];
  private readonly config: ChainForkConfig;

  constructor(startEpoch: Epoch, config: ChainForkConfig) {
    this.config = config;

    const {startSlot, count} = getBatchSlotRange(startEpoch);
    this.forkName = this.config.getForkName(startSlot);
    this.startEpoch = startEpoch;
    this.startSlot = startSlot;
    this.count = count;
    this.requests = this.getRequests([]);
  }

  /**
   * Builds ByRange requests for block, blobs and columns
   */
  private getRequests(blocks: IBlockInput[]): BatchRequests {
    let blockStartSlot = this.startSlot;
    let dataStartSlot = this.startSlot;
    const neededColumns = new Set<number>();

    // ensure blocks are in slot-wise order
    for (const blockInput of blocks.sort((a, b) => a.slot - b.slot)) {
      const blockSlot = blockInput.slot;
      // check if block/data is present and if start of range is directly before blockSlot to avoid
      // missing blocks/data if there is a gap. just pull remainder of range
      // ie startSlot = 32 and have [32, 33, 34, 35, 36, _, 38, 39, _, _, ... _missing endSlot=63_]
      // will return a startSlot of 37 and pull range 37-63
      if (blockInput.hasBlock() && blockStartSlot === blockSlot) {
        blockStartSlot = blockSlot + 1;
      }
      if (!blockInput.hasAllData()) {
        if (isBlockInputColumns(blockInput)) {
          for (const missing of blockInput.getMissingSampledColumnMeta()) {
            neededColumns.add(missing.index);
          }
        }
      } else if (dataStartSlot === blockSlot) {
        dataStartSlot = blockSlot + 1;
      }
    }

    const endSlot = this.startSlot + this.count - 1;
    const requests: BatchRequests = {
      blocksRequest:
        blockStartSlot <= endSlot
          ? {
              startSlot: blockStartSlot,
              // range of 40 - 63, startSlot will be inclusive but subtraction will exclusive so need to + 1
              count: endSlot - blockStartSlot + 1,
              step: 1,
            }
          : undefined,
    };
    if (dataStartSlot <= this.startSlot + this.count) {
      if (isForkPostFulu(this.forkName)) {
        requests.columnsRequest = {
          startSlot: dataStartSlot,
          count: endSlot - dataStartSlot + 1,
          columns: Array.from(neededColumns),
        };
      } else if (isForkPostDeneb(this.forkName)) {
        requests.blobsRequest = {
          startSlot: dataStartSlot,
          count: endSlot - dataStartSlot + 1,
        };
      }
    }
    return requests;
  }

  /**
   * Gives a list of peers from which this batch has had a failed download or processing attempt.
   */
  getFailedPeers(): PeerIdStr[] {
    return [...this.failedDownloadAttempts, ...this.failedProcessingAttempts.flatMap((a) => a.peers)];
  }

  getMetadata(): BatchMetadata {
    return {startEpoch: this.startEpoch, status: this.state.status};
  }

  /**
   * AwaitingDownload -> Downloading
   */
  startDownloading(peer: PeerIdStr): BatchRequests {
    if (this.state.status !== BatchStatus.AwaitingDownload) {
      throw new BatchError(this.wrongStatusErrorType(BatchStatus.AwaitingDownload));
    }

    this.state = {status: BatchStatus.Downloading, peer, blocks: this.state.blocks ?? []};
  }

  /**
   * Downloading -> AwaitingProcessing
   * pendingDataColumns is null when a complete download is done, otherwise it contains the columns that are still pending
   */
  downloadingSuccess(peer: PeerIdStr, blocks: IBlockInput[]): DownloadSuccessOutput {
    if (this.state.status !== BatchStatus.Downloading) {
      throw new BatchError(this.wrongStatusErrorType(BatchStatus.Downloading));
    }

    this.goodPeers.push(peer);

    let allComplete = true;
    const slots = new Set<number>();
    for (const block of blocks) {
      slots.add(block.slot);
      if (!block.hasBlockAndAllData()) {
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
    if (slots.size === this.count && allComplete) {
      this.state = {status: BatchStatus.AwaitingProcessing, blocks};
    } else {
      this.requests = this.getRequests(blocks);
      this.state = {status: BatchStatus.AwaitingDownload, blocks};
    }
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

    this.state = {status: BatchStatus.AwaitingDownload, blocks: this.state.blocks};
  }

  /**
   * AwaitingProcessing -> Processing
   */
  startProcessing(): IBlockInput[] {
    if (this.state.status !== BatchStatus.AwaitingProcessing) {
      throw new BatchError(this.wrongStatusErrorType(BatchStatus.AwaitingProcessing));
    }

    const blocks = this.state.blocks;
    const hash = hashBlocks(blocks, this.config); // tracks blocks to report peer on processing error
    // Reset goodPeers in case another download attempt needs to be made.  When Attempt is successful or not the peers
    // that the data came from will be handled by the Attempt that goes for processing
    const peers = this.goodPeers;
    this.goodPeers = [];
    this.state = {status: BatchStatus.Processing, attempt: {peers, hash}};
    return blocks;
  }

  /**
   * Processing -> AwaitingValidation
   */
  processingSuccess(): void {
    if (this.state.status !== BatchStatus.Processing) {
      throw new BatchError(this.wrongStatusErrorType(BatchStatus.Processing));
    }

    this.state = {status: BatchStatus.AwaitingValidation, attempt: this.state.attempt};
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
    this.state = {status: BatchStatus.AwaitingDownload};
  }

  private onProcessingError(attempt: Attempt): void {
    this.failedProcessingAttempts.push(attempt);
    if (this.failedProcessingAttempts.length > MAX_BATCH_PROCESSING_ATTEMPTS) {
      throw new BatchError(this.errorType({code: BatchErrorCode.MAX_PROCESSING_ATTEMPTS}));
    }

    // remove any downloaded blocks and re-attempt
    // TODO(fulu): need to remove the bad blocks from the SeenBlockInputCache
    this.state = {status: BatchStatus.AwaitingDownload};
  }

  /** Helper to construct typed BatchError. Stack traces are correct as the error is thrown above */
  private errorType(type: BatchErrorType): BatchErrorType & BatchErrorMetadata {
    return {...type, ...this.getMetadata()};
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
