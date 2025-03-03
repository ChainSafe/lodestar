import {CheckpointWithHex} from "@lodestar/fork-choice";
import {Logger} from "@lodestar/utils";
import {IBeaconDb} from "../../db/index.js";
import {Metrics} from "../../metrics/metrics.js";
import {JobItemQueue} from "../../util/queue/index.js";
import {ChainEvent} from "../emitter.js";
import {IBeaconChain} from "../interface.js";
import {PROCESS_FINALIZED_CHECKPOINT_QUEUE_LEN} from "./constants.js";
import {ArchiveMode, ArchiverOpts, StateArchiveStrategy} from "./interface.js";
import {ArchiveBlocksObserver} from "./observers/archiveBlocksObserver.js";
import {BackFillObserver} from "./observers/backFillObserver.js";
import {FrequencyStateArchiveStrategy} from "./strategies/frequencyStateArchiveStrategy.js";
import {pruneHistory} from "./utils/pruneHistory.js";
import { PruneHotStateObserver } from "./observers/pruneHotStateObserver.js";

/**
 * Used for running tasks that depends on some events or are executed
 * periodically.
 */
export class ArchiverStore {
  private archiveMode: ArchiveMode;
  private jobQueue: JobItemQueue<[CheckpointWithHex], void>;

  private prevFinalized: CheckpointWithHex;
  private readonly statesArchiverStrategy: StateArchiveStrategy;
  private archiveBlobEpochs?: number;

  constructor(
    private readonly db: IBeaconDb,
    private readonly chain: IBeaconChain,
    private readonly logger: Logger,
    signal: AbortSignal,
    private readonly opts: ArchiverOpts,
    private readonly metrics?: Metrics | null
  ) {
    if (opts.archiveMode === ArchiveMode.Frequency) {
      this.statesArchiverStrategy = new FrequencyStateArchiveStrategy(chain.regen, db, logger, opts, chain.bufferPool);
    } else {
      throw new Error(`State archive strategy "${opts.archiveMode}" currently not supported.`);
    }

    this.archiveMode = opts.archiveMode;
    this.archiveBlobEpochs = opts.archiveBlobEpochs;
    this.prevFinalized = chain.forkChoice.getFinalizedCheckpoint();
    this.jobQueue = new JobItemQueue<[CheckpointWithHex], void>(this.processFinalizedCheckpoint, {
      maxLength: PROCESS_FINALIZED_CHECKPOINT_QUEUE_LEN,
      signal,
    });

    if (!opts.disableArchiveOnCheckpoint) {
      this.chain.emitter.on(ChainEvent.forkChoiceFinalized, this.onFinalizedCheckpoint);

      signal.addEventListener(
        "abort",
        () => {
          this.chain.emitter.off(ChainEvent.forkChoiceFinalized, this.onFinalizedCheckpoint);
        },
        {once: true}
      );
    }

    if (!opts.disableArchiveOnCheckpoint) return;

    const archiveBlocksObserver = new ArchiveBlocksObserver(
      {
        forkChoice: this.chain.forkChoice,
        clock: this.chain.clock,
        config: this.chain.config,
        lightClientServer: this.chain.lightClientServer,
        db: this.db,
        logger: this.logger,
      },
      {archiveBlobEpochs: this.archiveBlobEpochs, signal}
    );
    archiveBlocksObserver.subscribe(this.chain.emitter, signal);

    const backfillObserver = new BackFillObserver(
      {
        chain: this.chain,
        db: this.db,
        logger: this.logger,
      },
      {signal}
    );
    backfillObserver.subscribe(this.chain.emitter, signal);

    const pruneHotStateObserver = new PruneHotStateObserver({
      forkChoice: this.chain.forkChoice,
      regen: this.chain.regen,
      logger: this.logger,
    });
    pruneHotStateObserver.subscribe(this.chain.emitter, signal);
  }

  /** Archive latest finalized state */
  async persistToDisk(): Promise<void> {
    return this.statesArchiverStrategy.archiveState(this.chain.forkChoice.getFinalizedCheckpoint());
  }

  private onFinalizedCheckpoint = async (finalized: CheckpointWithHex): Promise<void> => {
    return this.jobQueue.push(finalized);
  };

  private processFinalizedCheckpoint = async (finalized: CheckpointWithHex): Promise<void> => {
    try {
      const finalizedEpoch = finalized.epoch;
      this.logger.verbose("Start processing finalized checkpoint", {epoch: finalizedEpoch, rootHex: finalized.rootHex});
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

      this.logger.verbose("Finish processing finalized checkpoint", {
        epoch: finalizedEpoch,
        rootHex: finalized.rootHex,
      });
    } catch (e) {
      this.logger.error("Error processing finalized checkpoint", {epoch: finalized.epoch}, e as Error);
    }
  };
}
