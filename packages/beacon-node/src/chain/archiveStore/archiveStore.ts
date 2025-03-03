import {CheckpointWithHex} from "@lodestar/fork-choice";
import {Logger} from "@lodestar/utils";
import {IBeaconDb} from "../../db/index.js";
import {Metrics} from "../../metrics/metrics.js";
import {JobItemQueue} from "../../util/queue/index.js";
import {ChainEvent} from "../emitter.js";
import {IBeaconChain} from "../interface.js";
import {PROCESS_FINALIZED_CHECKPOINT_QUEUE_LEN} from "./constants.js";
import {ArchiveMode, ArchiverOpts} from "./interface.js";
import {ArchiveBlocksObserver} from "./observers/archiveBlocksObserver.js";
import {BackFillObserver} from "./observers/backFillObserver.js";
import {FrequentStateArchiveObserver} from "./observers/frequentStateArchiveObserver.js";
import {archiveState} from "./utils/frequentStateArchive.js";
import {pruneHistory} from "./utils/pruneHistory.js";

/**
 * Used for running tasks that depends on some events or are executed
 * periodically.
 */
export class ArchiverStore {
  private archiveMode: ArchiveMode;
  private jobQueue: JobItemQueue<[CheckpointWithHex], void>;

  private prevFinalized: CheckpointWithHex;
  private archiveBlobEpochs?: number;

  constructor(
    private readonly db: IBeaconDb,
    private readonly chain: IBeaconChain,
    private readonly logger: Logger,
    signal: AbortSignal,
    private readonly opts: ArchiverOpts,
    private readonly metrics?: Metrics | null
  ) {
    this.archiveMode = opts.archiveMode;
    this.archiveBlobEpochs = opts.archiveBlobEpochs;
    this.prevFinalized = chain.forkChoice.getFinalizedCheckpoint();
    this.jobQueue = new JobItemQueue<[CheckpointWithHex], void>(this.processFinalizedCheckpoint, {
      maxLength: PROCESS_FINALIZED_CHECKPOINT_QUEUE_LEN,
      signal,
    });

    if (!opts.disableArchiveOnCheckpoint) {
      this.chain.emitter.on(ChainEvent.forkChoiceFinalized, this.onFinalizedCheckpoint);
      this.chain.emitter.on(ChainEvent.checkpoint, this.onCheckpoint);

      signal.addEventListener(
        "abort",
        () => {
          this.chain.emitter.off(ChainEvent.forkChoiceFinalized, this.onFinalizedCheckpoint);
          this.chain.emitter.off(ChainEvent.checkpoint, this.onCheckpoint);
        },
        {once: true}
      );
    }

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

    if (this.archiveMode === ArchiveMode.Frequency) {
      const frequentStateArchiveObserver = new FrequentStateArchiveObserver(
        {
          db: this.db,
          logger: this.logger,
          regen: this.chain.regen,
          metrics: this.metrics,
          bufferPool: this.chain.bufferPool,
        },
        {signal, archiveStateEpochFrequency: opts.archiveStateEpochFrequency}
      );
      frequentStateArchiveObserver.subscribe(this.chain.emitter, signal);
    }
  }

  /** Archive latest finalized state */
  async persistToDisk(): Promise<void> {
    return archiveState(
      {
        bufferPool: this.chain.bufferPool,
        db: this.db,
        logger: this.logger,
        regen: this.chain.regen,
        metrics: this.metrics,
      },
      this.chain.forkChoice.getFinalizedCheckpoint()
    );
  }

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

      this.chain.regen.pruneOnFinalized(finalizedEpoch);

      // tasks rely on extended fork choice
      const prunedBlocks = this.chain.forkChoice.prune(finalized.rootHex);

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
