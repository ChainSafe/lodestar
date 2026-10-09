import {ChainForkConfig} from "@lodestar/config";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {RootHex} from "@lodestar/types";
import {Logger, sleep} from "@lodestar/utils";
import {Metrics} from "../metrics/metrics.js";
import {DataColumnReconstructionCode, recoverDataColumnSidecars} from "../util/dataColumns.js";
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

export type ColumnReconstructionInput = BlockInputColumns | PayloadEnvelopeInput;

export type ColumnReconstructionTrackerInit = {
  logger: Logger;
  emitter: ChainEventEmitter;
  metrics: Metrics | null;
  config: ChainForkConfig;
};

type QueuedReconstruction = {
  input: ColumnReconstructionInput;
  queuedAtMs: number;
  started: boolean;
};

/**
 * Runs column reconstruction one block root at a time, in trigger order. A trigger for a root already
 * in the queue is a no-op. A root is removed once its attempt finishes so a later column can retry a
 * failed attempt.
 */
export class ColumnReconstructionTracker {
  logger: Logger;
  emitter: ChainEventEmitter;
  metrics: Metrics | null;
  config: ChainForkConfig;

  private readonly queue = new Map<RootHex, QueuedReconstruction>();

  private readonly minDelayMs: number;
  private readonly maxDelayMs: number;

  constructor(init: ColumnReconstructionTrackerInit) {
    this.logger = init.logger;
    this.emitter = init.emitter;
    this.metrics = init.metrics;
    this.config = init.config;
    this.minDelayMs = this.config.getSlotComponentDurationMs(RECONSTRUCTION_DELAY_MIN_BPS);
    this.maxDelayMs = this.config.getSlotComponentDurationMs(RECONSTRUCTION_DELAY_MAX_BPS);
  }

  triggerColumnReconstruction(input: ColumnReconstructionInput): void {
    if (this.queue.has(input.blockRootHex)) {
      return;
    }

    if (input.getAllColumns().length < NUMBER_OF_COLUMNS / 2) {
      return;
    }

    this.queue.set(input.blockRootHex, {input, queuedAtMs: Date.now(), started: false});
    this.reconstructNext();
  }

  private reconstructNext(): void {
    const next = this.queue.values().next();
    if (next.done || next.value.started) {
      return;
    }

    next.value.started = true;
    const {input, queuedAtMs} = next.value;
    const logCtx = {slot: input.slot, root: input.blockRootHex};
    const delay = this.minDelayMs + Math.random() * (this.maxDelayMs - this.minDelayMs);

    // The delay gives gossip a chance to deliver the remaining columns, so time already spent in the
    // queue behind another root counts towards it
    sleep(delay - (Date.now() - queuedAtMs))
      .then(() => {
        this.logger.debug("Attempting data column sidecar reconstruction", logCtx);
        return recoverDataColumnSidecars(input, this.emitter, this.metrics);
      })
      .then((result) => {
        this.metrics?.recoverDataColumnSidecars.reconstructionResult.inc({result});
        this.logger.debug("Data column sidecar reconstruction complete", {...logCtx, result});
      })
      .catch((e) => {
        this.metrics?.recoverDataColumnSidecars.reconstructionResult.inc({
          result: DataColumnReconstructionCode.Failed,
        });
        this.logger.debug("Error during data column sidecar reconstruction", logCtx, e as Error);
      })
      .finally(() => {
        this.logger.debug("Data column sidecar reconstruction attempt finished", logCtx);
        this.queue.delete(input.blockRootHex);
        this.reconstructNext();
      });
  }
}
