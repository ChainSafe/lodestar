import {PeerId} from "@libp2p/interface-peer-id";
import {Epoch, phase0, RootHex} from "@lodestar/types";
import {ChainForkConfig} from "@lodestar/config";
import {LodestarError} from "@lodestar/utils";
import {MAX_BATCH_DOWNLOAD_ATTEMPTS, MAX_BATCH_PROCESSING_ATTEMPTS} from "../constants.js";
import {BlockInput} from "../../chain/blocks/types.js";
import {BlockError, BlockErrorCode} from "../../chain/errors/index.js";
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
  peer: PeerId;
  /** The hash of the blocks of the attempt */
  hash: RootHex;
};

export type BatchState =
  | {status: BatchStatus.AwaitingDownload}
  | {status: BatchStatus.Downloading; peer: PeerId}
  | {status: BatchStatus.AwaitingProcessing; peer: PeerId; blocks: BlockInput[]}
  | {status: BatchStatus.Processing; attempt: Attempt}
  | {status: BatchStatus.AwaitingValidation; attempt: Attempt};

export type BatchMetadata = {
  startEpoch: Epoch;
  status: BatchStatus;
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
  readonly startEpoch: Epoch;
  /** State of the batch. */
  state: BatchState = {status: BatchStatus.AwaitingDownload};
  /** BeaconBlocksByRangeRequest */
  readonly request: phase0.BeaconBlocksByRangeRequest;
  /** The `Attempts` that have been made and failed to send us this batch. */
  readonly failedProcessingAttempts: Attempt[] = [];
  /** The `Attempts` that have been made and failed because of execution malfunction. */
  readonly executionErrorAttempts: Attempt[] = [];
  /** The number of download retries this batch has undergone due to a failed request. */
  private readonly failedDownloadAttempts: PeerId[] = [];
  private readonly config: ChainForkConfig;

  constructor(startEpoch: Epoch, config: ChainForkConfig) {
    const {startSlot, count} = getBatchSlotRange(startEpoch);

    this.config = config;
    this.startEpoch = startEpoch;
    this.request = {
      startSlot,
      count,
      step: 1,
    };
  }

  /**
   * Gives a list of peers from which this batch has had a failed download or processing attempt.
   */
  getFailedPeers(): PeerId[] {
    return [...this.failedDownloadAttempts, ...this.failedProcessingAttempts.map((a) => a.peer)];
  }

  getMetadata(): BatchMetadata {
    return {startEpoch: this.startEpoch, status: this.state.status};
  }

  /**
   * AwaitingDownload -> Downloading
   */
  startDownloading(peer: PeerId): void {
    if (this.state.status !== BatchStatus.AwaitingDownload) {
      throw new BatchError(this.wrongStatusErrorType(BatchStatus.AwaitingDownload));
    }

    this.state = {status: BatchStatus.Downloading, peer};
  }

  /**
   * Downloading -> AwaitingProcessing
   */
  downloadingSuccess(blocks: BlockInput[]): void {
    if (this.state.status !== BatchStatus.Downloading) {
      throw new BatchError(this.wrongStatusErrorType(BatchStatus.Downloading));
    }

    this.state = {status: BatchStatus.AwaitingProcessing, peer: this.state.peer, blocks};
  }

  /**
   * Downloading -> AwaitingDownload
   */
  downloadingError(): void {
    if (this.state.status !== BatchStatus.Downloading) {
      throw new BatchError(this.wrongStatusErrorType(BatchStatus.Downloading));
    }

    this.failedDownloadAttempts.push(this.state.peer);
    if (this.failedDownloadAttempts.length > MAX_BATCH_DOWNLOAD_ATTEMPTS) {
      throw new BatchError(this.errorType({code: BatchErrorCode.MAX_DOWNLOAD_ATTEMPTS}));
    }

    this.state = {status: BatchStatus.AwaitingDownload};
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

    this.state = {status: BatchStatus.AwaitingDownload};
  }

  private onProcessingError(attempt: Attempt): void {
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
