import {ChainForkConfig} from "@lodestar/config";
import {ColumnIndex, Epoch, RootHex, fulu, phase0} from "@lodestar/types";
import {LodestarError} from "@lodestar/utils";
import {BlockInput} from "../../chain/blocks/types.js";
import {BlockError, BlockErrorCode} from "../../chain/errors/index.js";
import {PeerIdStr} from "../../util/peerId.js";
import {MAX_BATCH_DOWNLOAD_ATTEMPTS, MAX_BATCH_PROCESSING_ATTEMPTS} from "../constants.js";
import {getBatchSlotRange, hashBlocks, PeerWithOverlap} from "./utils/index.js";
import {CustodyConfig} from "../../util/dataColumns.js";
import {isForkPostDeneb, isForkPostFulu} from "@lodestar/params";
import {DownloadByRangeErrorCode, DownloadByRangeRequests} from "./utils/downloadByRange.js";

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

export type DownloadingAttempt = {
  /** The peer that made the attempt */
  peer: PeerIdStr;
  /** Type of failure if one happened */
  errorCode: DownloadByRangeErrorCode;
};

export type ProcessingAttempt = {
  /** The peer that made the attempt */
  peer: PeerIdStr;
  /** The hash of the blocks of the attempt */
  hash: RootHex;
};

export type BatchState =
  | {status: BatchStatus.AwaitingDownload; blocks?: BlockInput[]}
  | {status: BatchStatus.Downloading; peer: PeerWithOverlap; blocks?: BlockInput[]}
  | {status: BatchStatus.AwaitingProcessing; peer: PeerIdStr; blocks: BlockInput[]}
  | {status: BatchStatus.Processing; attempt: ProcessingAttempt}
  | {status: BatchStatus.AwaitingValidation; attempt: ProcessingAttempt};

export type BatchMetadata = {
  startEpoch: Epoch;
  status: BatchStatus;
};

enum BatchForkType {
  noData = "noData",
  blobs = "blobs",
  columns = "columns",
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
  readonly startEpoch: Epoch;
  /** State of the batch. */
  state: BatchState = {status: BatchStatus.AwaitingDownload};
  /** Columns that need to be downloaded */
  neededColumns?: ColumnIndex[];
  /** Start slot to request for range */
  readonly startSlot: number;
  /** Number of slots in range to request */
  readonly count: number;
  /** Type of data that needs to be fetched */
  readonly forkType: BatchForkType;
  /** The `Attempts` that have been made and failed to send us this batch. */
  readonly failedProcessingAttempts: ProcessingAttempt[] = [];
  /** The `Attempts` that have been made and failed because of execution malfunction. */
  readonly executionErrorAttempts: ProcessingAttempt[] = [];
  /** The number of download retries this batch has undergone due to a failed request. */
  readonly failedDownloadAttempts: DownloadingAttempt[] = [];

  private readonly config: ChainForkConfig;

  constructor(startEpoch: Epoch, config: ChainForkConfig, custodyConfig: CustodyConfig) {
    const {startSlot, count} = getBatchSlotRange(startEpoch);
    if (isForkPostFulu()) {
      this.forkType = BatchForkType.columns;
      this.neededColumns = custodyConfig.sampledColumns;
    } else if (isForkPostDeneb()) {
      this.forkType = BatchForkType.blobs;
    } else {
      this.forkType = BatchForkType.noData;
    }

    this.config = config;
    this.startEpoch = startEpoch;
    this.startSlot = startSlot;
    this.count = count;
  }

  get requests(): DownloadByRangeRequests {
    if (this.state.status !== BatchStatus.Downloading) {
      throw new BatchError(this.wrongStatusErrorType(BatchStatus.Downloading));
    }
    return {
      blocksRequest: this.state.blocks ? undefined : {count: this.count, startSlot: this.startSlot, step: 1},
      blobsRequest: this.forkType === BatchForkType.blobs ? {count: this.count, startSlot: this.startSlot} : undefined,
      columnsRequest: this.state.peer.overlappingColumns
        ? {count: this.count, startSlot: this.startSlot, columns: this.state.peer.overlappingColumns}
        : undefined,
    };
  }

  /**
   * Gives a list of peers from which this batch has had a failed download or processing attempt.
   */
  getFailedPeers(): PeerIdStr[] {
    return [...this.failedDownloadAttempts, ...this.failedProcessingAttempts.map((a) => a.peer)];
  }

  getMetadata(): BatchMetadata {
    return {startEpoch: this.startEpoch, status: this.state.status};
  }

  /**
   * AwaitingDownload -> Downloading
   */
  startDownloading(peer: PeerWithOverlap): void {
    if (this.state.status !== BatchStatus.AwaitingDownload) {
      throw new BatchError(this.wrongStatusErrorType(BatchStatus.AwaitingDownload));
    }

    this.state = {status: BatchStatus.Downloading, peer, blocks: this.state.blocks};
  }

  /**
   * Downloading -> AwaitingProcessing
   */
  downloadingSuccess(blocks: BlockInput[], neededColumns?: ColumnIndex[]): void {
    if (this.state.status !== BatchStatus.Downloading) {
      throw new BatchError(this.wrongStatusErrorType(BatchStatus.Downloading));
    }

    this.neededColumns = neededColumns;
    if (this.neededColumns) {
      this.state = {status: BatchStatus.AwaitingDownload, blocks};
    } else {
      this.state = {status: BatchStatus.AwaitingProcessing, peer: this.state.peer.peerId, blocks};
    }
  }

  /**
   * Downloading -> AwaitingDownload
   */
  downloadingError(errorCode: DownloadByRangeErrorCode): void {
    if (this.state.status !== BatchStatus.Downloading) {
      throw new BatchError(this.wrongStatusErrorType(BatchStatus.Downloading));
    }

    this.failedDownloadAttempts.push({peer: this.state.peer, errorCode});
    if (this.failedDownloadAttempts.length > MAX_BATCH_DOWNLOAD_ATTEMPTS) {
      throw new BatchError(this.errorType({code: BatchErrorCode.MAX_DOWNLOAD_ATTEMPTS}));
    }

    this.state = {status: BatchStatus.AwaitingDownload, blocks: this.state.blocks};
  }

  /**
   * AwaitingProcessing -> Processing
   */
  startProcessing(): BlockInput[] {
    if (this.state.status !== BatchStatus.AwaitingProcessing) {
      throw new BatchError(this.wrongStatusErrorType(BatchStatus.AwaitingProcessing));
    }

    const blocks = this.state.blocks;
    const hash = hashBlocks(blocks, this.config); // tracks blocks to report peer on processing error
    this.state = {status: BatchStatus.Processing, attempt: {peer: this.state.peer, hash}};
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
  validationSuccess(): ProcessingAttempt {
    if (this.state.status !== BatchStatus.AwaitingValidation) {
      throw new BatchError(this.wrongStatusErrorType(BatchStatus.AwaitingValidation));
    }
    return this.state.attempt;
  }

  private onExecutionEngineError(attempt: ProcessingAttempt): void {
    this.executionErrorAttempts.push(attempt);
    if (this.executionErrorAttempts.length > MAX_BATCH_PROCESSING_ATTEMPTS) {
      throw new BatchError(this.errorType({code: BatchErrorCode.MAX_EXECUTION_ENGINE_ERROR_ATTEMPTS}));
    }

    this.state = {status: BatchStatus.AwaitingDownload};
  }

  private onProcessingError(attempt: ProcessingAttempt): void {
    this.failedProcessingAttempts.push(attempt);
    if (this.failedProcessingAttempts.length > MAX_BATCH_PROCESSING_ATTEMPTS) {
      throw new BatchError(this.errorType({code: BatchErrorCode.MAX_PROCESSING_ATTEMPTS}));
    }

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
  MAX_DOWNLOAD_ATTEMPTS = "BATCH_ERROR_MAX_DOWNLOAD_ATTEMPTS",
  MAX_PROCESSING_ATTEMPTS = "BATCH_ERROR_MAX_PROCESSING_ATTEMPTS",
  MAX_EXECUTION_ENGINE_ERROR_ATTEMPTS = "MAX_EXECUTION_ENGINE_ERROR_ATTEMPTS",
}

type BatchErrorType =
  | {code: BatchErrorCode.WRONG_STATUS; expectedStatus: BatchStatus}
  | {code: BatchErrorCode.MAX_DOWNLOAD_ATTEMPTS}
  | {code: BatchErrorCode.MAX_PROCESSING_ATTEMPTS}
  | {code: BatchErrorCode.MAX_EXECUTION_ENGINE_ERROR_ATTEMPTS};

type BatchErrorMetadata = {
  startEpoch: number;
  status: BatchStatus;
};

export class BatchError extends LodestarError<BatchErrorType & BatchErrorMetadata> {}
