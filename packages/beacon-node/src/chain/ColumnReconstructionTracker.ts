import {ChainForkConfig} from "@lodestar/config";
import {Logger, sleep} from "@lodestar/utils";
import {Metrics} from "../metrics/metrics.js";
import {DataColumnReconstructionCode, recoverDataColumnSidecars} from "../util/dataColumns.js";
import {BlockInputColumns} from "./blocks/blockInput/index.js";
import {ChainEventEmitter} from "./emitter.js";

/**
 * Minimum delay before attempting reconstruction in basis points (BPS) of slot duration.
 * 667 BPS = 6.67% of slot. For a 12s slot, this equates to ~800ms.
 */
const RECONSTRUCTION_DELAY_MIN_BPS = 667;

/**
 * Maximum delay before attempting reconstruction in basis points (BPS) of slot duration.
 * 1000 BPS = 10% of slot. For a 12s slot, this equates to 1200ms.
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
   * Track last attempted block root
   *
   * This is sufficient to avoid duplicate calls since we only call this
   * function when we see a new data column sidecar from gossip.
   */
  lastBlockRootHex: string | null = null;
  /** Track if a reconstruction attempt is in-flight */
  running = false;

  constructor(init: ColumnReconstructionTrackerInit) {
    this.logger = init.logger;
    this.emitter = init.emitter;
    this.metrics = init.metrics;
    this.config = init.config;
  }

  triggerColumnReconstruction(blockInput: BlockInputColumns): void {
    if (this.running) {
      return;
    }

    if (this.lastBlockRootHex === blockInput.blockRootHex) {
      return;
    }

    // We don't care about the outcome of this call,
    // just that it has been triggered for this block root.
    this.running = true;
    this.lastBlockRootHex = blockInput.blockRootHex;
    const minDelayMs = this.config.getSlotComponentDurationMs(RECONSTRUCTION_DELAY_MIN_BPS);
    const maxDelayMs = this.config.getSlotComponentDurationMs(RECONSTRUCTION_DELAY_MAX_BPS);
    const delay = minDelayMs + Math.random() * (maxDelayMs - minDelayMs);
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
            this.running = false;
          });
      })
      .catch((err) => {
        this.logger.debug("ColumnReconstructionTracker unreachable error", {}, err);
      });
  }
}
