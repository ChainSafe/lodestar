import {CheckpointWithHex} from "@lodestar/fork-choice";
import {Logger} from "@lodestar/utils";
import {IBeaconDb} from "../../db/index.js";
import {Metrics} from "../../metrics/metrics.js";
import {JobItemQueue} from "../../util/queue/index.js";
import {ChainEvent} from "../emitter.js";
import {IBeaconChain} from "../interface.js";
import {PROCESS_FINALIZED_CHECKPOINT_QUEUE_LEN} from "./constants.js";
import {ArchiveMode, ArchiverOpts, StateArchiveStrategy} from "./interface.js";
import {FrequencyStateArchiveStrategy} from "./strategies/frequencyStateArchiveStrategy.js";
import {archiveBlocks} from "./utils/archiveBlocks.js";
import {pruneHistory} from "./utils/pruneHistory.js";
import {updateBackfillRange} from "./utils/updateBackfillRange.js";

type ArchiveStoreModules = {
  chain: IBeaconChain;
  db: IBeaconDb;
  logger: Logger;
  metrics: Metrics | null;
};

/**
 * Used for running tasks that depends on some events or are executed
 * periodically.
 */
export class ArchiveStore {
  private archiveMode: ArchiveMode;
  private jobQueue: JobItemQueue<[CheckpointWithHex], void>;

  private prevFinalized: CheckpointWithHex;
  private archiveBlobEpochs?: number;
  private readonly statesArchiverStrategy: StateArchiveStrategy;
  private readonly chain: IBeaconChain;
  private readonly db: IBeaconDb;
  private readonly logger: Logger;
  private readonly metrics: Metrics | null;
  private readonly opts: ArchiverOpts;
  private readonly signal: AbortSignal;

  constructor(modules: ArchiveStoreModules, opts: ArchiverOpts, signal: AbortSignal) {
    this.chain = modules.chain;
    this.db = modules.db;
    this.logger = modules.logger;
    this.metrics = modules.metrics;
    this.opts = opts;
    this.signal = signal;
    this.archiveMode = opts.archiveMode;
    this.archiveBlobEpochs = opts.archiveBlobEpochs;
    this.prevFinalized = this.chain.forkChoice.getFinalizedCheckpoint();

    this.jobQueue = new JobItemQueue<[CheckpointWithHex], void>(this.processFinalizedCheckpoint, {
      maxLength: PROCESS_FINALIZED_CHECKPOINT_QUEUE_LEN,
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

  async init(modules: ArchiveStoreModules, opts: ArchiverOpts, signal: AbortSignal): Promise<ArchiveStore> {
    return new ArchiveStore(modules, opts, signal);
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

      this.prevFinalized = finalized;

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
