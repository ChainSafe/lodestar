import {AbortSignal} from "@chainsafe/abort-controller";
import {ILogger} from "@chainsafe/lodestar-utils";

import {IBeaconDb} from "../../db";
import {ChainEvent, IBeaconChain} from "..";
import {archiveBlocks} from "./archiveBlocks";
import {StatesArchiver} from "./archiveStates";
import {JobItemQueue} from "../../util/queue";
import {CheckpointWithHex} from "@chainsafe/lodestar-fork-choice";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";

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
    private readonly chain: IBeaconChain,
    private readonly logger: ILogger,
    signal: AbortSignal
  ) {
    this.statesArchiver = new StatesArchiver(chain.checkpointStateCache, db, logger);
    this.jobQueue = new JobItemQueue<[CheckpointWithHex], void>(this.processFinalizedCheckpoint, {
      maxLength: PROCESS_FINALIZED_CHECKPOINT_QUEUE_LEN,
      signal,
    });

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

  /** Archive latest finalized state */
  async persistToDisk(): Promise<void> {
    await this.statesArchiver.archiveState(this.chain.forkChoice.getFinalizedCheckpoint());
  }

  private onFinalizedCheckpoint = async (finalized: CheckpointWithHex): Promise<void> => {
    return this.jobQueue.push(finalized);
  };

  private onCheckpoint = async (): Promise<void> => {
    const headStateRoot = this.chain.forkChoice.getHead().stateRoot;
    await Promise.all([
      this.chain.checkpointStateCache.prune(
        this.chain.forkChoice.getFinalizedCheckpoint().epoch,
        this.chain.forkChoice.getJustifiedCheckpoint().epoch
      ),
      this.chain.stateCache.prune(headStateRoot),
    ]);
  };

  private processFinalizedCheckpoint = async (finalized: CheckpointWithHex): Promise<void> => {
    try {
      const finalizedEpoch = finalized.epoch;
      this.logger.verbose("Start processing finalized checkpoint", {epoch: finalizedEpoch});
      await archiveBlocks(this.db, this.chain.forkChoice, this.chain.lightClientServer, this.logger, finalized);

      // Mark the sequence in backfill db from finalized slot till anchor slot as filled
      const currentSlot = finalized.epoch * SLOTS_PER_EPOCH;
      await this.db.backfilledRanges.put(currentSlot, this.chain.anchorSlot);

      // Clear previously marked sequence till anchorSlot, without touching backfill sync
      // process sequence which are at <=anchorSlot i.e. clear >anchorSlot and < currentSlot
      const filteredSeqs = await this.db.backfilledRanges.keys({gt: this.chain.anchorSlot, lt: currentSlot});
      await this.db.backfilledRanges.batchDelete(filteredSeqs);

      // should be after ArchiveBlocksTask to handle restart cleanly
      await this.statesArchiver.maybeArchiveState(finalized);

      await Promise.all([
        this.chain.checkpointStateCache.pruneFinalized(finalizedEpoch),
        this.chain.stateCache.deleteAllBeforeEpoch(finalizedEpoch),
      ]);

      // tasks rely on extended fork choice
      this.chain.forkChoice.prune(finalized.rootHex);
      this.logger.verbose("Finish processing finalized checkpoint", {epoch: finalizedEpoch});
    } catch (e) {
      this.logger.error("Error processing finalized checkpoint", {epoch: finalized.epoch}, e as Error);
    }
  };
}
