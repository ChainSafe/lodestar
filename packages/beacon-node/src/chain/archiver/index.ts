import {Logger} from "@lodestar/utils";

import {CheckpointWithHex} from "@lodestar/fork-choice";
import {IBeaconDb} from "../../db/index.js";
import {JobItemQueue} from "../../util/queue/index.js";
import {IBeaconChain} from "../interface.js";
import {ChainEvent} from "../emitter.js";
import {StatesArchiver, StatesArchiverOpts} from "./archiveStates.js";
import {archiveBlocks} from "./archiveBlocks.js";

const PROCESS_FINALIZED_CHECKPOINT_QUEUE_LEN = 256;

export type ArchiverOpts = StatesArchiverOpts & {
  disableArchiveOnCheckpoint?: boolean;
};

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
    private readonly logger: Logger,
    signal: AbortSignal,
    opts: ArchiverOpts
  ) {
    this.statesArchiver = new StatesArchiver(chain.checkpointStateCache, db, logger, opts);
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
  }

  /** Archive latest finalized state */
  async persistToDisk(): Promise<void> {
    await this.statesArchiver.archiveState(this.chain.forkChoice.getFinalizedCheckpoint());
  }

  private onFinalizedCheckpoint = async (finalized: CheckpointWithHex): Promise<void> => {
    return this.jobQueue.push(finalized);
  };

  private onCheckpoint = (): void => {
    const headStateRoot = this.chain.forkChoice.getHead().stateRoot;
    this.chain.checkpointStateCache.prune(
      this.chain.forkChoice.getFinalizedCheckpoint().epoch,
      this.chain.forkChoice.getJustifiedCheckpoint().epoch
    );
    this.chain.stateCache.prune(headStateRoot);
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
        this.chain.clock.currentEpoch
      );

      // should be after ArchiveBlocksTask to handle restart cleanly
      await this.statesArchiver.maybeArchiveState(finalized);

      this.chain.checkpointStateCache.pruneFinalized(finalizedEpoch);
      this.chain.stateCache.deleteAllBeforeEpoch(finalizedEpoch);
      // tasks rely on extended fork choice
      this.chain.forkChoice.prune(finalized.rootHex);
      await this.updateBackfillRange(finalized);

      this.logger.verbose("Finish processing finalized checkpoint", {
        epoch: finalizedEpoch,
        rootHex: finalized.rootHex,
      });
    } catch (e) {
      this.logger.error("Error processing finalized checkpoint", {epoch: finalized.epoch}, e as Error);
    }
  };

  /**
   * Backfill sync relies on verified connected ranges (which are represented as key,value
   * with a verified jump from a key back to value). Since the node could have progressed
   * ahead from, we need to save the forward progress of this node as another backfill
   * range entry, that backfill sync will use to jump back if this node is restarted
   * for any reason.
   * The current backfill has its own backfill entry from anchor slot to last backfilled
   * slot. And this would create the entry from the current finalized slot to the anchor
   * slot.
   */
  private updateBackfillRange = async (finalized: CheckpointWithHex): Promise<void> => {
    try {
      // Mark the sequence in backfill db from finalized block's slot till anchor slot as
      // filled.
      const finalizedBlockFC = this.chain.forkChoice.getBlockHex(finalized.rootHex);
      if (finalizedBlockFC && finalizedBlockFC.slot > this.chain.anchorStateLatestBlockSlot) {
        await this.db.backfilledRanges.put(finalizedBlockFC.slot, this.chain.anchorStateLatestBlockSlot);

        // Clear previously marked sequence till anchorStateLatestBlockSlot, without
        // touching backfill sync process sequence which are at
        // <=anchorStateLatestBlockSlot i.e. clear >anchorStateLatestBlockSlot
        // and < currentSlot
        const filteredSeqs = await this.db.backfilledRanges.entries({
          gt: this.chain.anchorStateLatestBlockSlot,
          lt: finalizedBlockFC.slot,
        });
        this.logger.debug("updated backfilledRanges", {
          key: finalizedBlockFC.slot,
          value: this.chain.anchorStateLatestBlockSlot,
        });
        if (filteredSeqs.length > 0) {
          await this.db.backfilledRanges.batchDelete(filteredSeqs.map((entry) => entry.key));
          this.logger.debug(
            `Forward Sync - cleaned up backfilledRanges between ${finalizedBlockFC.slot},${this.chain.anchorStateLatestBlockSlot}`,
            {seqs: JSON.stringify(filteredSeqs)}
          );
        }
      }
    } catch (e) {
      this.logger.error("Error updating backfilledRanges on finalization", {epoch: finalized.epoch}, e as Error);
    }
  };
}
