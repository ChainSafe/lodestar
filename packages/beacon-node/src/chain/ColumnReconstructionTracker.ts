import {ChainForkConfig} from "@lodestar/config";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {RootHex} from "@lodestar/types";
import {Logger, sleep} from "@lodestar/utils";
import {Metrics} from "../metrics/metrics.js";
import {DataColumnReconstructionCode, recoverDataColumnSidecars} from "../util/dataColumns.js";
import {JobItemQueue} from "../util/queue/index.js";
import {BlockInputColumns} from "./blocks/blockInput/index.js";
import {PayloadEnvelopeInput} from "./blocks/payloadEnvelopeInput/index.js";
import {ChainEventEmitter} from "./emitter.js";

/**
 * Minimum time to wait before attempting reconstruction
 */
const RECONSTRUCTION_DELAY_MIN_BPS = 667;

/**
 * Maximum time to wait before attempting reconstruction
 */
const RECONSTRUCTION_DELAY_MAX_BPS = 1000;

const QUEUE_MAX_LENGTH = 16;

export type ColumnReconstructionInput = BlockInputColumns | PayloadEnvelopeInput;

export type ColumnReconstructionTrackerInit = {
  logger: Logger;
  emitter: ChainEventEmitter;
  metrics: Metrics | null;
  config: ChainForkConfig;
  signal: AbortSignal;
};

/**
 * Runs column reconstruction one block root at a time, in trigger order. A trigger for a root that is
 * queued or in flight is a no-op. A root is removed once its attempt finishes so a later column can
 * retry a failed attempt.
 */
export class ColumnReconstructionTracker {
  logger: Logger;
  emitter: ChainEventEmitter;
  metrics: Metrics | null;
  config: ChainForkConfig;

  private readonly signal: AbortSignal;
  private readonly pending = new Set<RootHex>();
  private readonly queue: JobItemQueue<[ColumnReconstructionInput, number], void>;

  constructor(init: ColumnReconstructionTrackerInit) {
    this.logger = init.logger;
    this.emitter = init.emitter;
    this.metrics = init.metrics;
    this.config = init.config;
    this.signal = init.signal;
    this.queue = new JobItemQueue(
      this.reconstruct,
      {maxLength: QUEUE_MAX_LENGTH, signal: init.signal},
      init.metrics?.columnReconstructionQueue
    );
  }

  triggerColumnReconstruction(input: ColumnReconstructionInput): void {
    if (this.pending.has(input.blockRootHex)) {
      return;
    }

    if (input.getAllColumns().length < NUMBER_OF_COLUMNS / 2) {
      return;
    }

    this.pending.add(input.blockRootHex);
    void this.enqueue(input);
  }

  private async enqueue(input: ColumnReconstructionInput): Promise<void> {
    try {
      await this.queue.push(input, Date.now());
    } catch (e) {
      this.logger.debug(
        "Data column sidecar reconstruction dropped",
        {slot: input.slot, root: input.blockRootHex},
        e as Error
      );
    } finally {
      this.pending.delete(input.blockRootHex);
    }
  }

  private reconstruct = async (input: ColumnReconstructionInput, queuedAtMs: number): Promise<void> => {
    const fork = this.config.getForkName(input.slot);
    const minDelayMs = this.config.getSlotComponentDurationMs(fork, RECONSTRUCTION_DELAY_MIN_BPS);
    const maxDelayMs = this.config.getSlotComponentDurationMs(fork, RECONSTRUCTION_DELAY_MAX_BPS);
    const delay = minDelayMs + Math.random() * (maxDelayMs - minDelayMs);

    // The delay gives gossip a chance to deliver the remaining columns, so time already spent in the
    // queue behind another root counts towards it
    await sleep(delay - (Date.now() - queuedAtMs), this.signal);

    const logCtx = {slot: input.slot, root: input.blockRootHex};
    this.logger.debug("Attempting data column sidecar reconstruction", logCtx);
    try {
      const result = await recoverDataColumnSidecars(input, this.emitter, this.metrics);
      this.metrics?.recoverDataColumnSidecars.reconstructionResult.inc({result});
      this.logger.debug("Data column sidecar reconstruction complete", {...logCtx, result});
    } catch (e) {
      this.metrics?.recoverDataColumnSidecars.reconstructionResult.inc({result: DataColumnReconstructionCode.Failed});
      this.logger.debug("Error during data column sidecar reconstruction", logCtx, e as Error);
    } finally {
      this.logger.debug("Data column sidecar reconstruction attempt finished", logCtx);
    }
  };
}
