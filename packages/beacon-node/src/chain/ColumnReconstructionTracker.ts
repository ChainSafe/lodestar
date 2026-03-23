import {ChainForkConfig} from "@lodestar/config";
import {Logger, sleep} from "@lodestar/utils";
import {Metrics} from "../metrics/metrics.js";
import {
  DataColumnReconstructionCode,
  recoverDataColumnSidecars,
  recoverGloasDataColumnSidecars,
} from "../util/dataColumns.js";
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

export type ColumnReconstructionTrackerInit = {
  logger: Logger;
  emitter: ChainEventEmitter;
  metrics: Metrics | null;
  config: ChainForkConfig;
};

/**
 * Tracks column reconstruction attempts to avoid duplicate and multiple in-flight calls
 */
export class ColumnReconstructionTracker {
  logger: Logger;
  emitter: ChainEventEmitter;
  metrics: Metrics | null;
  config: ChainForkConfig;

  /**
   * Track last attempted block root per pipeline (Fulu vs Gloas).
   * Separate state prevents one pipeline's in-flight reconstruction
   * from blocking the other.
   */
  private fuluLastBlockRootHex: string | null = null;
  private fuluRunning = false;
  private gloasLastBlockRootHex: string | null = null;
  private gloasRunning = false;

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

  triggerColumnReconstruction(blockInput: BlockInputColumns): void {
    if (this.fuluRunning) {
      return;
    }

    if (this.fuluLastBlockRootHex === blockInput.blockRootHex) {
      return;
    }

    // We don't care about the outcome of this call,
    // just that it has been triggered for this block root.
    this.fuluRunning = true;
    this.fuluLastBlockRootHex = blockInput.blockRootHex;
    const delay = this.minDelayMs + Math.random() * (this.maxDelayMs - this.minDelayMs);
    sleep(delay)
      .then(() => {
        const logCtx = {slot: blockInput.slot, root: blockInput.blockRootHex};
        this.logger.debug("Attempting data column sidecar reconstruction", logCtx);
        recoverDataColumnSidecars(blockInput, this.emitter, this.metrics)
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
            this.fuluRunning = false;
          });
      })
      .catch((err) => {
        this.logger.debug("ColumnReconstructionTracker unreachable error", {}, err);
      });
  }

  triggerPayloadEnvelopeReconstruction(payloadInput: PayloadEnvelopeInput, onComplete?: () => void): void {
    if (this.gloasRunning) {
      return;
    }

    if (this.gloasLastBlockRootHex === payloadInput.blockRootHex) {
      return;
    }

    this.gloasRunning = true;
    this.gloasLastBlockRootHex = payloadInput.blockRootHex;
    const delay = this.minDelayMs + Math.random() * (this.maxDelayMs - this.minDelayMs);
    sleep(delay)
      .then(() => {
        const logCtx = {slot: payloadInput.slot, root: payloadInput.blockRootHex};
        this.logger.debug("Attempting Gloas data column sidecar reconstruction", logCtx);
        recoverGloasDataColumnSidecars(payloadInput, this.emitter, this.metrics)
          .then((result) => {
            this.metrics?.recoverDataColumnSidecars.reconstructionResult.inc({result});
            this.logger.debug("Gloas data column sidecar reconstruction complete", {...logCtx, result});
            if (result === DataColumnReconstructionCode.SuccessResolved && payloadInput.isComplete()) {
              onComplete?.();
            }
          })
          .catch((e) => {
            this.metrics?.recoverDataColumnSidecars.reconstructionResult.inc({
              result: DataColumnReconstructionCode.Failed,
            });
            this.logger.debug("Error during Gloas data column sidecar reconstruction", logCtx, e as Error);
          })
          .finally(() => {
            this.logger.debug("Gloas data column sidecar reconstruction attempt finished", logCtx);
            this.gloasRunning = false;
          });
      })
      .catch((err) => {
        this.logger.debug("ColumnReconstructionTracker unreachable error", {}, err);
      });
  }
}
