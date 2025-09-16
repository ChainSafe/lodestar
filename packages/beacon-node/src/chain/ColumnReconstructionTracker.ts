import {ChainForkConfig} from "@lodestar/config";
import {Logger, sleep} from "@lodestar/utils";
import {Metrics} from "../metrics/metrics.js";
import {DataColumnReconstructionCode, recoverDataColumnSidecars} from "../util/dataColumns.js";
import {BlockInputColumns} from "./blocks/blockInput/index.js";
import {ChainEventEmitter} from "./emitter.js";

/**
 * Maximum added delay before attempting reconstruction
 *
 * From the spec:
 * If delaying reconstruction, nodes may use a random delay in order to desynchronize reconstruction among nodes, thus reducing overall CPU load.
 */
const RECONSTRUCTION_RANDOM_DELAY_MAX_MS = 200;

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

  triggerColumnReconstruction(delay: number, blockInput: BlockInputColumns): void {
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
    sleep(delay + Math.random() * RECONSTRUCTION_RANDOM_DELAY_MAX_MS)
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
