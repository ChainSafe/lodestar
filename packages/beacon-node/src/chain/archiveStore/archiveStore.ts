import {CheckpointWithHex} from "@lodestar/fork-choice";
import {LoggerNode} from "@lodestar/logger/node";
import {Checkpoint} from "@lodestar/types/phase0";
import {callFnWhenAwait} from "@lodestar/utils";
import {IBeaconDb} from "../../db/index.js";
import {Metrics} from "../../metrics/metrics.js";
import {isOptimisticBlock} from "../../util/forkChoice.js";
import {JobItemQueue, isQueueErrorAborted} from "../../util/queue/index.js";
import {ChainEvent} from "../emitter.js";
import {IBeaconChain} from "../interface.js";
import {PROCESS_FINALIZED_CHECKPOINT_QUEUE_LENGTH} from "./constants.js";
import {HistoricalStateRegen} from "./historicalState/historicalStateRegen.js";
import {ArchiveStoreOpts, ArchiveStoreTask} from "./interface.js";
import {migrateFinalizedDA} from "./utils/archiveBlocks.js";
import {pruneHistory} from "./utils/pruneHistory.js";
import {updateBackfillRange} from "./utils/updateBackfillRange.js";

type ArchiveStoreModules = {
  chain: IBeaconChain;
  db: IBeaconDb;
  logger: LoggerNode;
  metrics: Metrics | null;
};

type ArchiveStoreInitOpts = ArchiveStoreOpts & {dbName: string; anchorState: {finalizedCheckpoint: Checkpoint}};

/**
 * Used for running tasks that depends on some events or are executed
 * periodically.
 */
export class ArchiveStore {
  private jobQueue: JobItemQueue<[CheckpointWithHex], void>;

  private archiveDataEpochs?: number;
  private readonly chain: IBeaconChain;
  private readonly db: IBeaconDb;
  private readonly logger: LoggerNode;
  private readonly metrics: Metrics | null;
  private readonly opts: ArchiveStoreInitOpts;
  private readonly signal: AbortSignal;

  private historicalStateRegen?: HistoricalStateRegen;

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
    // event wiring and the DA/light-client cleanup driven by migrateFinalized's snapshot.

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
      await callFnWhenAwait(
        pruneHistory(
          this.chain.config,
          this.db,
          this.logger,
          this.metrics,
          this.opts.anchorState.finalizedCheckpoint.epoch,
          this.chain.clock.currentEpoch
        ),
        () => this.logger.info("Still pruning historical data, please wait..."),
        30_000,
        this.signal
      );
    }

    if (this.opts.serveHistoricalState) {
      this.historicalStateRegen = await HistoricalStateRegen.init({
        opts: {
          genesisTime: this.chain.clock.genesisTime,
          dbLocation: this.opts.dbName,
          nativeStateView: this.opts.nativeStateView ?? false,
        },
        config: this.chain.config,
        metrics: this.metrics,
        logger: this.logger,
        signal: this.signal,
      });
    }
  }

  async close(): Promise<void> {
    await this.historicalStateRegen?.close();
  }

  async scrapeMetrics(): Promise<string> {
    return this.historicalStateRegen?.scrapeMetrics() ?? "";
  }

  async getHistoricalStateBySlot(
    slot: number
  ): Promise<{state: Uint8Array; executionOptimistic: boolean; finalized: boolean} | null> {
    const finalizedBlock = this.chain.forkChoice.getFinalizedBlock();

    if (slot >= finalizedBlock.slot) {
      return null;
    }

    // request for finalized state using historical state regen
    const stateSerialized = await this.historicalStateRegen?.getHistoricalState(slot);
    if (!stateSerialized) {
      return null;
    }

    return {state: stateSerialized, executionOptimistic: isOptimisticBlock(finalizedBlock), finalized: true};
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
    this.jobQueue.push(finalized).catch((e) => {
      if (!isQueueErrorAborted(e)) {
        this.logger.error("Error queuing finalized checkpoint", {epoch: finalized.epoch}, e as Error);
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

      // Engine-owned persistence, consolidated into one method: canonical blocks hot→cold, finalized
      // state archive, fork-choice prune. Returns the snapshot the facade uses for DA/light-client cleanup.
      const {snapshot, prunedBlocks} = await this.chain.beaconEngine.migrateFinalized(finalized);

      if (this.opts.pruneHistory) {
        const timer = this.metrics?.processFinalizedCheckpoint.durationByTask.startTimer();
        await pruneHistory(
          this.chain.config,
          this.db,
          this.logger,
          this.metrics,
          finalizedEpoch,
          this.chain.clock.currentEpoch
        );
        timer?.({source: ArchiveStoreTask.PruneHistory});
      }

      // Facade cleans the DA / light-client artifacts it still owns, driven by the snapshot.
      let timer = this.metrics?.processFinalizedCheckpoint.durationByTask.startTimer();
      await migrateFinalizedDA(
        this.chain.config,
        this.db,
        this.chain.lightClientServer,
        this.logger,
        snapshot,
        finalizedEpoch,
        this.chain.clock.currentEpoch,
        this.archiveDataEpochs
      );
      timer?.({source: ArchiveStoreTask.ArchiveBlocks});

      timer = this.metrics?.processFinalizedCheckpoint.durationByTask.startTimer();
      await updateBackfillRange({chain: this.chain, db: this.db, logger: this.logger}, finalized);
      timer?.({source: ArchiveStoreTask.UpdateBackfillRange});

      this.logger.verbose("Finish processing finalized checkpoint", {
        epoch: finalizedEpoch,
        rootHex: finalized.rootHex,
        prunedBlocks: prunedBlocks.length,
      });
    } catch (e) {
      if (!this.signal.aborted) {
        this.logger.error("Error processing finalized checkpoint", {epoch: finalized.epoch}, e as Error);
      }
    }
  };
}
