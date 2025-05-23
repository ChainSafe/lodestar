import {CheckpointWithHex} from "@lodestar/fork-choice";
import {LoggerNode} from "@lodestar/logger/node";
import {Checkpoint} from "@lodestar/types/phase0";
import {callFnWhenAwait} from "@lodestar/utils";
import {IBeaconDb} from "../../db/index.js";
import {Metrics} from "../../metrics/metrics.js";
import {isOptimisticBlock} from "../../util/forkChoice.js";
import {JobItemQueue} from "../../util/queue/index.js";
import {ChainEvent} from "../emitter.js";
import {IBeaconChain} from "../interface.js";
import {PROCESS_FINALIZED_CHECKPOINT_QUEUE_LENGTH} from "./constants.js";
import {HistoricalStateRegen} from "./historicalState/historicalStateRegen.js";
import {ArchiveMode, ArchiveStoreOpts, StateArchiveStrategy} from "./interface.js";
import {FrequencyStateArchiveStrategy} from "./strategies/frequencyStateArchiveStrategy.js";
import {archiveBlocks} from "./utils/archiveBlocks.js";
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
  private archiveMode: ArchiveMode;
  private jobQueue: JobItemQueue<[CheckpointWithHex], void>;

  private archiveBlobEpochs?: number;
  private readonly statesArchiverStrategy: StateArchiveStrategy;
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
    this.archiveMode = opts.archiveMode;
    this.archiveBlobEpochs = opts.archiveBlobEpochs;

    this.jobQueue = new JobItemQueue<[CheckpointWithHex], void>(this.processFinalizedCheckpoint, {
      maxLength: PROCESS_FINALIZED_CHECKPOINT_QUEUE_LENGTH,
      signal,
    });

    if (opts.archiveMode === ArchiveMode.Frequency) {
      this.statesArchiverStrategy = new FrequencyStateArchiveStrategy(
        this.chain.regen,
        this.db,
        this.logger,
        opts,
        this.chain.bufferPool
      );
    } else {
      throw new Error(`State archive strategy "${opts.archiveMode}" currently not supported.`);
    }

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
    return this.statesArchiverStrategy.archiveState(this.chain.forkChoice.getFinalizedCheckpoint());
  }

  //-------------------------------------------------------------------------
  // Event handlers
  //-------------------------------------------------------------------------
  private onFinalizedCheckpoint = async (finalized: CheckpointWithHex): Promise<void> => {
    return this.jobQueue.push(finalized);
  };

  private onCheckpoint = (): void => {
    const headStateRoot = this.chain.forkChoice.getHead().stateRoot;
    this.chain.regen.pruneOnCheckpoint(
      this.chain.forkChoice.getFinalizedCheckpoint().epoch,
      this.chain.forkChoice.getJustifiedCheckpoint().epoch,
      headStateRoot
    );

    this.statesArchiverStrategy.onCheckpoint(headStateRoot, this.metrics).catch((err) => {
      this.logger.error("Error during state archive", {archiveMode: this.archiveMode}, err);
    });
  };

  private processFinalizedCheckpoint = async (finalized: CheckpointWithHex): Promise<void> => {
    try {
      const finalizedEpoch = finalized.epoch;
      this.logger.verbose("Start processing finalized checkpoint", {epoch: finalizedEpoch, rootHex: finalized.rootHex});
      await archiveBlocks(
        this.chain.config,
        this.db,
        this.chain.forkChoice,
        this.chain.lightClientServer,
        this.logger,
        finalized,
        this.chain.clock.currentEpoch,
        this.archiveBlobEpochs
      );
      if (this.opts.pruneHistory) {
        await pruneHistory(
          this.chain.config,
          this.db,
          this.logger,
          this.metrics,
          finalizedEpoch,
          this.chain.clock.currentEpoch
        );
      }

      await this.statesArchiverStrategy.onFinalizedCheckpoint(finalized, this.metrics);

      // should be after ArchiveBlocksTask to handle restart cleanly
      await this.statesArchiverStrategy.maybeArchiveState(finalized, this.metrics);

      this.chain.regen.pruneOnFinalized(finalizedEpoch);

      // tasks rely on extended fork choice
      const prunedBlocks = this.chain.forkChoice.prune(finalized.rootHex);
      await updateBackfillRange({chain: this.chain, db: this.db, logger: this.logger}, finalized);

      this.logger.verbose("Finish processing finalized checkpoint", {
        epoch: finalizedEpoch,
        rootHex: finalized.rootHex,
        prunedBlocks: prunedBlocks.length,
      });
    } catch (e) {
      this.logger.error("Error processing finalized checkpoint", {epoch: finalized.epoch}, e as Error);
    }
  };
}
