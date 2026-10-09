import {ChainForkConfig} from "@lodestar/config";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {Logger, pruneSetToMax} from "@lodestar/utils";
import {BLOB_AND_PROOF_V2_RPC_BYTES} from "../execution/engine/types.js";
import {IExecutionEngine} from "../execution/index.js";
import {Metrics} from "../metrics/metrics.js";
import {
  DataColumnEngineResult,
  getBlobSidecarsFromExecution,
  getDataColumnSidecarsFromExecution,
} from "../util/execution.js";
import {IBlockInput, isBlockInputBlobs} from "./blocks/blockInput/index.js";
import {PayloadEnvelopeInput} from "./blocks/payloadEnvelopeInput/index.js";
import {ChainEventEmitter} from "./emitter.js";

/** A `null` answer only changes if the EL receives the transactions later, so retries are few and spaced out */
export const MAX_GET_BLOBS_ATTEMPTS = 3;
export const GET_BLOBS_RETRY_INTERVAL_MS = 1000;
const MAX_TRACKED_BLOCK_ROOTS = 64;

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
  activeReconstructions = new Set<string>();
  failedAttempts = new Map<string, {count: number; lastAttemptMs: number; retryTimer?: NodeJS.Timeout}>();
  // Preallocate buffers for getBlobsV2 RPC calls
  // See https://github.com/ChainSafe/lodestar/pull/8282 for context
  blobsAndProofsBuffers: {buffers: Uint8Array[]; inUse: boolean}[] = [];

  constructor(init: GetBlobsTrackerInit) {
    this.logger = init.logger;
    this.executionEngine = init.executionEngine;
    this.emitter = init.emitter;
    this.metrics = init.metrics;
    this.config = init.config;
  }

  triggerGetBlobs(input: IBlockInput | PayloadEnvelopeInput): void {
    if (this.activeReconstructions.has(input.blockRootHex)) {
      return;
    }

    const failed = this.failedAttempts.get(input.blockRootHex);
    if (failed) {
      if (failed.count >= MAX_GET_BLOBS_ATTEMPTS) {
        return;
      }
      const waitMs = GET_BLOBS_RETRY_INTERVAL_MS - (Date.now() - failed.lastAttemptMs);
      if (waitMs > 0) {
        // Columns tend to arrive in one burst, so keep a single trailing retry instead of relying on a later trigger
        failed.retryTimer ??= setTimeout(() => {
          failed.retryTimer = undefined;
          if (this.failedAttempts.get(input.blockRootHex) === failed && !input.hasAllData()) {
            this.triggerGetBlobs(input);
          }
        }, waitMs).unref();
        return;
      }
    }

    // The request is sent right away, before block processing issues newPayload: ELs that drop a
    // transaction's blobs once the payload is validated can only answer a request that gets there first
    if (!(input instanceof PayloadEnvelopeInput) && isBlockInputBlobs(input)) {
      // there is not preallocation for blob sidecars like there is for columns sidecars so no need to
      // store the index for the preallocated buffers
      this.activeReconstructions.add(input.blockRootHex);
      const logCtx = {slot: input.slot, root: input.blockRootHex};
      this.logger.verbose("Trigger getBlobsV1 for block", logCtx);
      getBlobSidecarsFromExecution(this.config, this.executionEngine, this.metrics, this.emitter, input)
        .catch((error) => {
          this.logger.debug("Error during getBlobsV1 for block", logCtx, error as Error);
          this.recordFailedAttempt(input.blockRootHex);
        })
        .finally(() => {
          this.logger.verbose("Completed getBlobsV1 for block", logCtx);
          this.activeReconstructions.delete(input.blockRootHex);
        });

      return;
    }

    let freeIndex = this.blobsAndProofsBuffers.findIndex(({inUse}) => !inUse);
    if (freeIndex === -1) {
      freeIndex = this.blobsAndProofsBuffers.length;
      this.blobsAndProofsBuffers[freeIndex] = {inUse: false, buffers: []};
    }

    const maxBlobs = this.config.getMaxBlobsPerBlock(computeEpochAtSlot(input.slot));
    // double check that there is enough pre-allocated space (blob schedule may have changed since the last use)
    const timer = this.metrics?.peerDas.getBlobsV2PreAllocationTime.startTimer();
    for (let i = 0; i < maxBlobs; i++) {
      if (this.blobsAndProofsBuffers[freeIndex].buffers[i] === undefined) {
        this.blobsAndProofsBuffers[freeIndex].buffers[i] = new Uint8Array(BLOB_AND_PROOF_V2_RPC_BYTES);
      }
    }
    timer?.();

    // We don't care about the outcome of this call,
    // just that it has been triggered for this block root.
    this.activeReconstructions.add(input.blockRootHex);
    this.blobsAndProofsBuffers[freeIndex].inUse = true;
    const logCtx = {slot: input.slot, root: input.blockRootHex};
    this.logger.verbose("Trigger getBlobsV2 for block", logCtx);
    getDataColumnSidecarsFromExecution(
      this.config,
      this.executionEngine,
      this.emitter,
      input,
      this.metrics,
      this.blobsAndProofsBuffers[freeIndex].buffers
    )
      .then((result) => {
        this.logger.debug("getBlobsV2 result for block", {...logCtx, result});
        this.metrics?.dataColumns.dataColumnEngineResult.inc({result});
        if (result === DataColumnEngineResult.NullResponse) {
          this.recordFailedAttempt(input.blockRootHex);
        }
      })
      .catch((error) => {
        this.logger.debug("Error during getBlobsV2 for block", logCtx, error as Error);
        this.metrics?.dataColumns.dataColumnEngineResult.inc({result: DataColumnEngineResult.Failed});
        this.recordFailedAttempt(input.blockRootHex);
      })
      .finally(() => {
        this.logger.verbose("Completed getBlobsV2 for block", logCtx);
        this.activeReconstructions.delete(input.blockRootHex);
        this.blobsAndProofsBuffers[freeIndex].inUse = false;
      });
  }

  private recordFailedAttempt(blockRootHex: string): void {
    const failed = this.failedAttempts.get(blockRootHex);
    clearTimeout(failed?.retryTimer);
    this.failedAttempts.set(blockRootHex, {count: (failed?.count ?? 0) + 1, lastAttemptMs: Date.now()});
    pruneSetToMax(this.failedAttempts, MAX_TRACKED_BLOCK_ROOTS);
  }
}
