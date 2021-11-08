import {AbortSignal} from "@chainsafe/abort-controller";
import {ILogger} from "@chainsafe/lodestar-utils";

import {IBeaconDb} from "../../db";
import {ChainEvent, ChainEventEmitter} from "..";
import {archiveBlocks} from "./archiveBlocks";
import {StatesArchiver} from "./archiveStates";
import {JobItemQueue} from "../../util/queue";
import {CheckpointWithHex, IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {CheckpointStateCache, StateContextCache} from "../stateCache";

const PROCESS_FINALIZED_CHECKPOINT_QUEUE_LEN = 256;

/**
 * Used for running tasks that depends on some events or are executed
 * periodically.
 */
export class Archiver {
  private jobQueue: JobItemQueue<[CheckpointWithHex], void>;

  private readonly statesArchiver: StatesArchiver;

  constructor(
    private readonly db: IBeaconDb,
    private readonly forkChoice: IForkChoice,
    private readonly checkpointStateCache: CheckpointStateCache,
    private readonly stateCache: StateContextCache,
    private readonly emitter: ChainEventEmitter,
    private readonly logger: ILogger,
    signal: AbortSignal
  ) {
    this.statesArchiver = new StatesArchiver(this.checkpointStateCache, db, logger);
    this.jobQueue = new JobItemQueue<[CheckpointWithHex], void>(this.processFinalizedCheckpoint, {
      maxLength: PROCESS_FINALIZED_CHECKPOINT_QUEUE_LEN,
      signal,
    });

    this.emitter.on(ChainEvent.forkChoiceFinalized, this.onFinalizedCheckpoint);
    this.emitter.on(ChainEvent.checkpoint, this.onCheckpoint);

    signal.addEventListener(
      "abort",
      () => {
        this.emitter.off(ChainEvent.forkChoiceFinalized, this.onFinalizedCheckpoint);
        this.emitter.off(ChainEvent.checkpoint, this.onCheckpoint);
      },
      {once: true}
    );
  }

  /** Archive latest finalized state */
  async persistToDisk(): Promise<void> {
    await this.statesArchiver.archiveState(this.forkChoice.getFinalizedCheckpoint());
  }

  private onFinalizedCheckpoint = async (finalized: CheckpointWithHex): Promise<void> => {
    return this.jobQueue.push(finalized);
  };

  private onCheckpoint = async (): Promise<void> => {
    const headStateRoot = this.forkChoice.getHead().stateRoot;
    await Promise.all([
      this.checkpointStateCache.prune(
        this.forkChoice.getFinalizedCheckpoint().epoch,
        this.forkChoice.getJustifiedCheckpoint().epoch
      ),
      this.stateCache.prune(headStateRoot),
    ]);
  };

  private processFinalizedCheckpoint = async (finalized: CheckpointWithHex): Promise<void> => {
    try {
      const finalizedEpoch = finalized.epoch;
      this.logger.verbose("Start processing finalized checkpoint", {epoch: finalizedEpoch});
      await archiveBlocks(this.db, this.forkChoice, this.logger, finalized);

      // should be after ArchiveBlocksTask to handle restart cleanly
      await this.statesArchiver.maybeArchiveState(finalized);

      await Promise.all([
        this.checkpointStateCache.pruneFinalized(finalizedEpoch),
        this.stateCache.deleteAllBeforeEpoch(finalizedEpoch),
      ]);

      // tasks rely on extended fork choice
      this.forkChoice.prune(finalized.rootHex);
      this.logger.verbose("Finish processing finalized checkpoint", {epoch: finalizedEpoch});
    } catch (e) {
      this.logger.error("Error processing finalized checkpoint", {epoch: finalized.epoch}, e as Error);
    }
  };
}
