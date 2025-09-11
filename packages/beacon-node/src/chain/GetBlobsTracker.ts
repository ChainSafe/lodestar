import {Logger} from "@lodestar/utils";
import {IExecutionEngine} from "../execution/index.js";
import {ChainEventEmitter} from "./emitter.js";
import {Metrics} from "../metrics/metrics.js";
import {ChainForkConfig} from "@lodestar/config";
import {IBlockInput} from "./blocks/blockInput/index.js";
import {getDataColumnSidecarsFromExecution} from "../util/execution.js";

export type GetBlobsTrackerInit = {
  logger: Logger;
  executionEngine: IExecutionEngine;
  emitter: ChainEventEmitter;
  metrics: Metrics | null;
  config: ChainForkConfig;
};

/**
 * Tracks getBlobsV2 calls to the execution engine to avoid duplicate and multiple in-flight calls
 */
export class GetBlobsTracker {
  logger: Logger;
  executionEngine: IExecutionEngine;
  emitter: ChainEventEmitter;
  metrics: Metrics | null;
  config: ChainForkConfig;

  /**
   * Track last attempted block root
   *
   * This is sufficient to avoid duplicate calls since we only call this
   * function when we see a new block or data column sidecar from gossip.
   */
  lastBlockRootHex: string | null = null;
  /** Track if a getBlobsV2 call is in-flight */
  running = false;
  // Preallocate buffers for getBlobsV2 RPC calls
  // See https://github.com/ChainSafe/lodestar/pull/8282 for context
  blobAndProofBuffers: Uint8Array[] = [];

  constructor(init: GetBlobsTrackerInit) {
    this.logger = init.logger;
    this.executionEngine = init.executionEngine;
    this.emitter = init.emitter;
    this.metrics = init.metrics;
    this.config = init.config;
  }

  triggerGetBlobs(blockInput: IBlockInput): void {
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
    getDataColumnSidecarsFromExecution(
      this.config,
      this.executionEngine,
      this.emitter,
      blockInput,
      this.metrics,
      this.blobAndProofBuffers
    ).finally(() => {
      this.running = false;
    });
  }
}
