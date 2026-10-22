import {CheckpointWithHex} from "@lodestar/fork-choice";
import {LoggerNode} from "@lodestar/logger/node";
import {Checkpoint} from "@lodestar/types/phase0";
import {callFnWhenAwait} from "@lodestar/utils";
import {IBeaconChainDb} from "../../db/index.js";
import {Metrics} from "../../metrics/metrics.js";
import {callInNextEventLoop} from "../../util/eventLoop.js";
import {JobItemQueue, isQueueErrorAborted} from "../../util/queue/index.js";
import {ChainEvent} from "../emitter.js";
import {IBeaconChain} from "../interface.js";
import {PROCESS_FINALIZED_CHECKPOINT_QUEUE_LENGTH} from "./constants.js";
import {ArchiveStoreOpts, ArchiveStoreTask} from "./interface.js";
import {archiveBlocks} from "./utils/archiveBlocks.js";

type ArchiveStoreModules = {
  chain: IBeaconChain;
  db: IBeaconChainDb;
  logger: LoggerNode;
  metrics: Metrics | null;
};

type ArchiveStoreInitOpts = ArchiveStoreOpts & {
  dbName: string;
  dataColumnDir: string;
  anchorState: {finalizedCheckpoint: Checkpoint};
};

/**
 * Used for running tasks that depends on some events or are executed
 * periodically.
 */
export class ArchiveStore {
  private jobQueue: JobItemQueue<[CheckpointWithHex], void>;

  private archiveDataEpochs?: number;
  private readonly chain: IBeaconChain;
  private readonly db: IBeaconChainDb;
  private readonly logger: LoggerNode;
  private readonly metrics: Metrics | null;
  private readonly opts: ArchiveStoreInitOpts;
  private readonly signal: AbortSignal;

  constructor(modules: ArchiveStoreModules, opts: ArchiveStoreInitOpts, signal: AbortSignal) {
    this.chain = modules.chain;
    this.db = modules.db;
    this.logger = modules.logger;
    this.metrics = modules.metrics;
    this.opts = opts;
    this.signal = signal;
    this.archiveDataEpochs = opts.archiveDataEpochs;

    this.jobQueue = new JobItemQueue<[CheckpointWithHex], void>(this.processFinalizedCheckpoint, {
      maxLength: PROCESS_FINALIZED_CHECKPOINT_QUEUE_LENGTH,
      signal,
    });

    // State archival is engine-owned. ArchiveStore coordinates it with BeaconChain's DA/light-client cleanup
    // and keeps fork choice and ChainView available until all dependent work completes.

    if (!opts.disableArchiveOnCheckpoint) {
      this.chain.emitter.on(ChainEvent.forkChoiceFinalized, this.onFinalizedCheckpoint);

      this.signal.addEventListener(
        "abort",
        () => {
          this.chain.emitter.off(ChainEvent.forkChoiceFinalized, this.onFinalizedCheckpoint);
        },
        {once: true}
      );
    }
  }

  async init(): Promise<void> {
    if (this.opts.pruneHistory) {
      // prune ALL stale data before starting
      this.logger.info("Pruning historical data");
      // Block, state and envelope DB writes are engine-owned; prune through the engine.
      await callFnWhenAwait(
        this.chain.beaconEngine.pruneHistory(
          this.opts.anchorState.finalizedCheckpoint.epoch,
          this.chain.clock.currentEpoch
        ),
        () => this.logger.info("Still pruning historical data, please wait..."),
        30_000,
        this.signal
      );
    }
  }

  /**
   * Archive latest finalized state
   * */
  async persistToDisk(): Promise<void> {
    return this.chain.beaconEngine.persistFinalizedStateToDisk();
  }

  //-------------------------------------------------------------------------
  // Event handlers
  //-------------------------------------------------------------------------
  private onFinalizedCheckpoint = (finalized: CheckpointWithHex): void => {
    // Decouple archival from finalization notification delivery so queue failures cannot interrupt other listeners.
    // `jobQueue.push()` can throw synchronously (queue aborted / full) or reject asynchronously;
    // awaiting it inside the deferred callback funnels both failure modes into the one catch.
    callInNextEventLoop(async () => {
      try {
        await this.jobQueue.push(finalized);
      } catch (e) {
        if (!isQueueErrorAborted(e)) {
          this.logger.error(
            "Error queuing finalized checkpoint",
            {epoch: finalized.epoch, rootHex: finalized.rootHex},
            e as Error
          );
        }
      }
    });
  };

  /**
   * The facade orchestrates finalization because blocks, envelopes, states and fork choice belong to BeaconEngine,
   * while columns and ChainView belong to BeaconChain. Keep these steps awaited in the checkpoint queue:
   * neither owner may prune its fork-choice metadata before the other has finished using it for archival
   * and cleanup. The detailed cross-owner ordering is documented in beaconEngine/processFinalizedCheckpoint.ts.
   */
  private processFinalizedCheckpoint = async (finalized: CheckpointWithHex): Promise<void> => {
    try {
      const finalizedEpoch = finalized.epoch;
      this.logger.verbose("Start processing finalized checkpoint", {epoch: finalizedEpoch, rootHex: finalized.rootHex});

      let timer = this.metrics?.processFinalizedCheckpoint.durationByTask.startTimer();
      await archiveBlocks(
        this.chain.config,
        this.db,
        this.chain.beaconEngine,
        this.chain.getFinalizedBlockSnapshot(finalized.rootHex),
        this.logger,
        finalized,
        this.chain.clock.currentEpoch,
        this.archiveDataEpochs,
        this.chain.opts.persistOrphanedBlocks,
        this.chain.opts.persistOrphanedBlocksDir
      );
      timer?.({source: ArchiveStoreTask.ArchiveBlocks});

      if (this.opts.pruneHistory) {
        timer = this.metrics?.processFinalizedCheckpoint.durationByTask.startTimer();
        const blockCutoffSlot = await this.chain.beaconEngine.pruneHistory(
          finalizedEpoch,
          this.chain.clock.currentEpoch
        );
        this.chain.earliestAvailableSlot = Math.max(this.chain.earliestAvailableSlot, blockCutoffSlot);
        timer?.({source: ArchiveStoreTask.PruneHistory});
      }

      // Prune fork choice and ChainView last. completeFinalization first awaits state archival, then prunes
      // fork choice; await its success before removing the corresponding metadata from ChainView.
      const prunedBlockCount = await this.chain.beaconEngine.completeFinalization(finalized);
      this.chain.pruneChainView(finalized);

      this.logger.verbose("Finish processing finalized checkpoint", {
        epoch: finalizedEpoch,
        rootHex: finalized.rootHex,
        prunedBlocks: prunedBlockCount,
      });
    } catch (e) {
      if (!this.signal.aborted) {
        this.logger.error("Error processing finalized checkpoint", {epoch: finalized.epoch}, e as Error);
      }
    }
  };
}
