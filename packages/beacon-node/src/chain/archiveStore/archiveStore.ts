import {CheckpointWithHex} from "@lodestar/fork-choice";
import {LoggerNode} from "@lodestar/logger/node";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
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

    // State archival (finalized + temp + shutdown) is engine-owned; the ArchiveStore keeps only the
    // event wiring and the DA/light-client cleanup driven by the engine's finalization snapshot.

    if (!opts.disableArchiveOnCheckpoint) {
      this.chain.emitter.on(ChainEvent.forkChoiceFinalized, this.onFinalizedCheckpoint);
      this.chain.emitter.on(ChainEvent.checkpoint, this.onCheckpoint);

      this.signal.addEventListener(
        "abort",
        () => {
          this.chain.emitter.off(ChainEvent.forkChoiceFinalized, this.onFinalizedCheckpoint);
          this.chain.emitter.off(ChainEvent.checkpoint, this.onCheckpoint);
        },
        {once: true}
      );
    }
  }

  async init(): Promise<void> {
    if (this.opts.pruneHistory) {
      // prune ALL stale data before starting
      this.logger.info("Pruning historical data");
      // Block + state DB is engine-owned; prune through the engine.
      const cutoff = await callFnWhenAwait(
        this.chain.beaconEngine.pruneHistory(
          this.opts.anchorState.finalizedCheckpoint.epoch,
          this.chain.clock.currentEpoch
        ),
        () => this.logger.info("Still pruning historical data, please wait..."),
        30_000,
        this.signal
      );
      await this.db.executionPayloadEnvelopeArchive.batchDelete(
        await this.db.executionPayloadEnvelopeArchive.keys({gte: 0, lt: cutoff})
      );
    }

    const earliest = await this.chain.beaconEngine.getEarliestArchivedBlockSlot();
    if (earliest !== null) this.chain.earliestAvailableSlot = earliest;
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
    // Decouple finalized-checkpoint processing from block import. This handler runs synchronously
    // inside the `ChainEvent.forkChoiceFinalized` emit from `forkChoice.onBlock()` during
    // `importBlock()`; deferring the work to the next event-loop tick keeps any failure here off the
    // import call stack, so it can't abort `importBlock()` before `regen.processState()` caches the
    // head post-state — the deep-sync wedge this PR fixes (#9716).
    //
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

  private onCheckpoint = (): void => {
    // Engine prunes regen caches and archives a temp checkpoint state (states DB is engine-owned).
    this.chain.beaconEngine.archiveStateOnCheckpoint().catch((err) => {
      this.logger.error("Error during state archive", {}, err);
    });
  };

  private processFinalizedCheckpoint = async (finalized: CheckpointWithHex): Promise<void> => {
    try {
      const finalizedEpoch = finalized.epoch;
      this.logger.verbose("Start processing finalized checkpoint", {epoch: finalizedEpoch, rootHex: finalized.rootHex});

      // we want to track late imported canonical blocks, but it's not nice to do it at syncig time
      const isNodeSynced = this.chain.clock.currentSlot - this.chain.beaconEngine.getHead().slot <= SLOTS_PER_EPOCH;

      let timer = this.metrics?.processFinalizedCheckpoint.durationByTask.startTimer();
      await archiveBlocks(
        this.chain.config,
        this.db,
        this.chain.beaconEngine,
        this.chain.lightClientServer,
        this.logger,
        finalized,
        this.chain.clock.currentEpoch,
        this.metrics,
        isNodeSynced,
        this.archiveDataEpochs,
        this.chain.opts.persistOrphanedBlocks,
        this.chain.opts.persistOrphanedBlocksDir,
        this.chain.opts.dedupePayloads
      );
      timer?.({source: ArchiveStoreTask.ArchiveBlocks});

      if (this.opts.pruneHistory) {
        timer = this.metrics?.processFinalizedCheckpoint.durationByTask.startTimer();
        const blockCutoffSlot = await this.chain.beaconEngine.pruneHistory(
          finalizedEpoch,
          this.chain.clock.currentEpoch
        );
        await this.db.executionPayloadEnvelopeArchive.batchDelete(
          await this.db.executionPayloadEnvelopeArchive.keys({gte: 0, lt: blockCutoffSlot})
        );
        this.chain.earliestAvailableSlot = Math.max(this.chain.earliestAvailableSlot, blockCutoffSlot);
        timer?.({source: ArchiveStoreTask.PruneHistory});
      }

      const prunedBlockCount = await this.chain.beaconEngine.completeFinalization(finalized);

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
