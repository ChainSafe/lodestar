import {Logger} from "@lodestar/utils";
import {CheckpointWithHex, IForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {Epoch, ValidatorIndex} from "@lodestar/types";
import {SLOTS_PER_EPOCH} from "@lodestar/params";

import {IBeaconDb} from "../../db/index.js";
import {JobItemQueue} from "../../util/queue/index.js";
import {IBeaconChain} from "../interface.js";
import {ChainEvent} from "../emitter.js";
import {CheckpointStateCache} from "../stateCache/index.js";
import {Metrics} from "../../metrics/metrics.js";
import {StatesArchiver, StatesArchiverOpts} from "./archiveStates.js";
import {archiveBlocks, FinalizedData} from "./archiveBlocks.js";

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
    opts: ArchiverOpts,
    private readonly metrics: Metrics | null
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
      const finalizedData = await archiveBlocks(
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

      const {
        checkpoints,
        attachedValidatorsOrphanedCount,
        attachedValidatorsMissedProposals,
        attachedValidatorsDoubleProposals,
        attachedProposers,
        missedProposals,
        doubleProposals,
        expectedProposals,
        orphanedProposals,
        finalizedCanonicalBlocksCount,
        finalizedNonCanonicalBlocksCount,
      } = this.collectMissedOrphaedStats(
        this.chain.checkpointStateCache,
        this.chain.forkChoice,
        this.chain.beaconProposerCache,
        finalizedData,
        finalized
      );

      this.metrics?.finalizedOrphanedCount.set(orphanedProposals);
      this.metrics?.finalizedMissedCount.set(missedProposals);
      this.metrics?.finalizedDoubleCount.set(doubleProposals);
      this.metrics?.finalizedSlotsRangeCount.set(checkpoints * SLOTS_PER_EPOCH);
      this.metrics?.finalizedAttachedValidatorsProposersCount.set(attachedProposers);
      this.metrics?.finalizedAttachedValidatorsProposalsCount.set(expectedProposals);
      this.metrics?.finalizedAttachedValidatorsMissedCount.set(attachedValidatorsMissedProposals);
      this.metrics?.finalizedAttachedValidatorsDoubleProposalsCount.set(attachedValidatorsDoubleProposals);
      this.metrics?.finalizedAttachedValidatorsOrphanedCount.set(attachedValidatorsOrphanedCount);
      this.metrics?.finalizedCanonicalBlocksCount.set(finalizedCanonicalBlocksCount);
      this.metrics?.finalizedNonCanonicalBlocksCount.set(finalizedNonCanonicalBlocksCount);

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

  private collectMissedOrphaedStats(
    checkpointStateCache: CheckpointStateCache,
    forkChoice: IForkChoice,
    beaconProposerCache: IBeaconChain["beaconProposerCache"],
    finalizedData: FinalizedData,
    finalized: CheckpointWithHex
  ): {
    checkpoints: number;
    foundCheckpoints: number;
    attachedProposers: number;
    attachedValidatorFoundProposals: number;
    doubleProposals: number;
    totalProposals: number;
    expectedProposals: number;
    orphanedProposals: number;
    missedProposals: number;
    finalizedCanonicalBlocksCount: number;
    finalizedNonCanonicalBlocksCount: number;
    attachedValidatorsMissedProposals: number;
    attachedValidatorsDoubleProposals: number;
    attachedValidatorsOrphanedCount: number;
  } {
    const {finalizedCanonicalCheckpoints, finalizedCanonicalBlocks, finalizedNonCanonicalBlocks} = finalizedData;

    const proposers = beaconProposerCache
      .getProposersSinceEpoch(finalized.epoch)
      .map((indexString) => Number(indexString));

    let expectedProposals = 0;
    let totalProposals = 0;
    let checkpoints = 0;

    let foundCheckpoints = 0;
    let attachedValidatorFoundProposals = 0;
    let orphanedProposals = 0;
    let missedProposals = 0;
    let finalizedEpoch = 0;
    const attachedValidatorsOrphanedCount = 0;
    let attachedValidatorsDoubleProposals = 0;
    let attachedValidatorsOrphanedBlocks = 0;
    // if any validator proposed twice for an epoch
    let doubleProposals = 0;
    let foundProposals = 0;
    const epochOrphanedProposals: ProtoBlock[] = [];
    const epochProposals: ProtoBlock[] = [];
    const doneEpochProposalsLocal = new Map<Epoch, ValidatorIndex[]>();

    // Get all the ancestors of the finalized till previous finalized
    for (const checkpointHex of finalizedCanonicalCheckpoints) {
      checkpoints++;
      const checkpointState = checkpointStateCache.get(checkpointHex);
      if (checkpointState !== null) {
        finalizedEpoch = checkpointState.epochCtx.epoch;
        foundCheckpoints++;
        totalProposals += checkpointState.epochCtx.proposers.length;
        epochProposals.push(
          ...finalizedCanonicalBlocks.filter((x) => Math.ceil(x.slot / SLOTS_PER_EPOCH) === finalizedEpoch)
        );
        epochOrphanedProposals.push(
          ...finalizedNonCanonicalBlocks.filter((x) => Math.ceil(x.slot / SLOTS_PER_EPOCH) === finalizedEpoch)
        );
        expectedProposals += checkpointState.epochCtx.proposers.filter((x) => proposers.includes(x)).length;
      }
    }

    for (const block of finalizedCanonicalBlocks) {
      const {slot, proposerIndex} = block;
      const epoch = Math.ceil(slot / SLOTS_PER_EPOCH);
      if (proposers.includes(proposerIndex)) {
        attachedValidatorFoundProposals++;
        const epochProposalsLocal = doneEpochProposalsLocal.get(epoch) ?? [];
        epochProposalsLocal.push(proposerIndex);
        doneEpochProposalsLocal.set(epoch, epochProposalsLocal);
      }
    }

    for (const block of finalizedNonCanonicalBlocks) {
      const {slot, proposerIndex} = block;
      const epoch = Math.ceil(slot / SLOTS_PER_EPOCH);
      if (proposers.includes(proposerIndex)) {
        attachedValidatorsOrphanedBlocks++;
        const epochProposalsLocal = doneEpochProposalsLocal.get(epoch) ?? [];
        if (epochProposalsLocal.includes(proposerIndex)) {
          attachedValidatorsDoubleProposals++;
        } else {
          epochProposalsLocal.push(proposerIndex);
          doneEpochProposalsLocal.set(epoch, epochProposalsLocal);
        }
      }
    }

    orphanedProposals = epochOrphanedProposals.length;
    foundProposals = epochProposals.length;
    doubleProposals = epochOrphanedProposals.filter((x) => epochProposals.includes(x)).length;
    missedProposals = totalProposals - foundProposals - orphanedProposals + doubleProposals;

    const attachedValidatorsMissedProposals =
      expectedProposals -
      attachedValidatorFoundProposals -
      attachedValidatorsOrphanedBlocks +
      attachedValidatorsDoubleProposals;

    const attachedProposers = proposers.length;
    const finalizedCanonicalBlocksCount = finalizedCanonicalBlocks.length;
    const finalizedNonCanonicalBlocksCount = finalizedNonCanonicalBlocks.length;

    return {
      checkpoints,
      foundCheckpoints,
      doubleProposals,
      attachedProposers,
      totalProposals,
      expectedProposals,
      missedProposals,
      orphanedProposals,
      attachedValidatorFoundProposals,
      attachedValidatorsDoubleProposals,
      attachedValidatorsMissedProposals,
      attachedValidatorsOrphanedCount,
      finalizedCanonicalBlocksCount,
      finalizedNonCanonicalBlocksCount,
    };
  }
}
