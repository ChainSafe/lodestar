import {ChainForkConfig} from "@lodestar/config";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {RootHex} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {HttpRequestTimes} from "../execution/engine/jsonRpcHttpClient.js";
import {BLOB_AND_PROOF_V2_RPC_BYTES} from "../execution/engine/types.js";
import {IExecutionEngine} from "../execution/index.js";
import {Metrics} from "../metrics/metrics.js";
import {callInNextEventLoop} from "../util/eventLoop.js";
import {
  DataColumnEngineResult,
  getBlobSidecarsFromExecution,
  getDataColumnSidecarsFromExecution,
} from "../util/execution.js";
import {IBlockInput, isBlockInputBlobs} from "./blocks/blockInput/index.js";
import {PayloadEnvelopeInput} from "./blocks/payloadEnvelopeInput/index.js";
import {BlockTrace} from "./blockTrace/index.js";
import {ChainEventEmitter} from "./emitter.js";

export type GetBlobsTrackerInit = {
  logger: Logger;
  executionEngine: IExecutionEngine;
  emitter: ChainEventEmitter;
  metrics: Metrics | null;
  config: ChainForkConfig;
  blockTrace: BlockTrace | null;
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
  blockTrace: BlockTrace | null;
  /** Roots with a call in progress, with a getBlobsV2 call's request times from its trigger */
  activeReconstructions = new Map<RootHex, HttpRequestTimes | null>();
  // Preallocate buffers for getBlobsV2 RPC calls
  // See https://github.com/ChainSafe/lodestar/pull/8282 for context
  blobsAndProofsBuffers: {buffers: Uint8Array[]; inUse: boolean}[] = [];

  constructor(init: GetBlobsTrackerInit) {
    this.logger = init.logger;
    this.executionEngine = init.executionEngine;
    this.emitter = init.emitter;
    this.metrics = init.metrics;
    this.config = init.config;
    this.blockTrace = init.blockTrace;
  }

  triggerGetBlobs(input: IBlockInput | PayloadEnvelopeInput): void {
    if (this.activeReconstructions.has(input.blockRootHex)) {
      return;
    }

    if (!(input instanceof PayloadEnvelopeInput) && isBlockInputBlobs(input)) {
      // there is not preallocation for blob sidecars like there is for columns sidecars so no need to
      // store the index for the preallocated buffers
      this.activeReconstructions.set(input.blockRootHex, null);
      callInNextEventLoop(() => {
        const logCtx = {slot: input.slot, root: input.blockRootHex};
        this.logger.verbose("Trigger getBlobsV1 for block", logCtx);
        getBlobSidecarsFromExecution(this.config, this.executionEngine, this.metrics, this.emitter, input).finally(
          () => {
            this.logger.verbose("Completed getBlobsV1 for block", logCtx);
            this.activeReconstructions.delete(input.blockRootHex);
          }
        );
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
    const times = new HttpRequestTimes();
    this.activeReconstructions.set(input.blockRootHex, times);
    this.blobsAndProofsBuffers[freeIndex].inUse = true;
    callInNextEventLoop(() => {
      const logCtx = {slot: input.slot, root: input.blockRootHex};
      this.logger.verbose("Trigger getBlobsV2 for block", logCtx);
      getDataColumnSidecarsFromExecution(
        this.config,
        this.executionEngine,
        this.emitter,
        input,
        this.metrics,
        this.blobsAndProofsBuffers[freeIndex].buffers,
        this.blockTrace,
        times
      )
        .then((result) => {
          this.logger.debug("getBlobsV2 result for block", {...logCtx, result});
          this.metrics?.dataColumns.dataColumnEngineResult.inc({result});
        })
        .catch((error) => {
          this.logger.debug("Error during getBlobsV2 for block", logCtx, error as Error);
          this.metrics?.dataColumns.dataColumnEngineResult.inc({result: DataColumnEngineResult.Failed});
        })
        .finally(() => {
          this.logger.verbose("Completed getBlobsV2 for block", logCtx);
          // A call that skipped the request ends its first attempt here
          times.endFirstAttempt();
          this.activeReconstructions.delete(input.blockRootHex);
          this.blobsAndProofsBuffers[freeIndex].inUse = false;
        });
    });
  }

  /** The request times of `root`'s getBlobsV2 call in progress, from its trigger; null when none is */
  requestInProgress(root: RootHex): HttpRequestTimes | null {
    return this.activeReconstructions.get(root) ?? null;
  }
}
