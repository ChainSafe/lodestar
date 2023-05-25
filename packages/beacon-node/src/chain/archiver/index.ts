import {Logger, LogLevel} from "@lodestar/utils";
import {CheckpointWithHex, IForkChoice} from "@lodestar/fork-choice";
import {ValidatorIndex, Slot} from "@lodestar/types";
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

type ProposalStats = {
  total: number;
  finalized: number;
  orphaned: number;
  missed: number;
};

export type FinalizedStats = {
  allValidators: ProposalStats;
  attachedValidators: ProposalStats;
  finalizedCanonicalCheckpointsCount: number;
  finalizedFoundCheckpointsInStateCache: number;
  finalizedAttachedValidatorsCount: number;
};

/**
 * Used for running tasks that depends on some events or are executed
 * periodically.
 */
export class Archiver {
  private jobQueue: JobItemQueue<[CheckpointWithHex], void>;

  private prevFinalized: CheckpointWithHex;
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
      this.collectFinalizedProposalStats(
        this.chain.checkpointStateCache,
        this.chain.forkChoice,
        this.chain.beaconProposerCache,
        finalizedData,
        finalized,
        this.prevFinalized
      );
      this.prevFinalized = finalized;

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

  private collectFinalizedProposalStats(
    checkpointStateCache: CheckpointStateCache,
    forkChoice: IForkChoice,
    beaconProposerCache: IBeaconChain["beaconProposerCache"],
    finalizedData: FinalizedData,
    finalized: CheckpointWithHex,
    lastFinalized: CheckpointWithHex
  ): FinalizedStats {
    const {finalizedCanonicalCheckpoints, finalizedCanonicalBlocks, finalizedNonCanonicalBlocks} = finalizedData;

    // Range to consider is:
    //   lastFinalized.epoch * SLOTS_PER_EPOCH + 1, .... finalized.epoch * SLOTS_PER_EPOCH
    // So we need to check proposer of lastFinalized (index 1 onwards) as well as 0th index proposer
    // of current finalized
    const finalizedProposersCheckpoints: FinalizedData["finalizedCanonicalCheckpoints"] =
      finalizedCanonicalCheckpoints.filter(
        (hexCheck) => hexCheck.epoch < finalized.epoch && hexCheck.epoch > lastFinalized.epoch
      );
    finalizedProposersCheckpoints.push(lastFinalized);
    finalizedProposersCheckpoints.push(finalized);

    // Sort the data to in following structure to make inferences
    const slotProposers = new Map<Slot, {canonicalVals: ValidatorIndex[]; nonCanonicalVals: ValidatorIndex[]}>();

    //  1. Process canonical blocks
    for (const block of finalizedCanonicalBlocks) {
      // simply set to the single entry as no double proposal can be there for same slot in canonical
      slotProposers.set(block.slot, {canonicalVals: [block.proposerIndex], nonCanonicalVals: []});
    }

    // 2. Process non canonical blocks
    for (const block of finalizedNonCanonicalBlocks) {
      const slotVals = slotProposers.get(block.slot) ?? {canonicalVals: [], nonCanonicalVals: []};
      slotVals.nonCanonicalVals.push(block.proposerIndex);
      slotProposers.set(block.slot, slotVals);
    }

    // Some simple calculatable stats for all validators
    const finalizedCanonicalCheckpointsCount = finalizedCanonicalCheckpoints.length;
    const expectedTotalProposalsCount = (finalized.epoch - lastFinalized.epoch) * SLOTS_PER_EPOCH;
    const finalizedCanonicalBlocksCount = finalizedCanonicalBlocks.length;
    const finalizedOrphanedProposalsCount = finalizedNonCanonicalBlocks.length;
    const finalizedMissedProposalsCount = expectedTotalProposalsCount - slotProposers.size;

    const allValidators: ProposalStats = {
      total: expectedTotalProposalsCount,
      finalized: finalizedCanonicalBlocksCount,
      orphaned: finalizedOrphanedProposalsCount,
      missed: finalizedMissedProposalsCount,
    };

    // Stats about the attached validators
    const attachedProposers = beaconProposerCache
      .getProposersSinceEpoch(finalized.epoch)
      .map((indexString) => Number(indexString));
    const finalizedAttachedValidatorsCount = attachedProposers.length;

    // Calculate stats for attached validators, based on states in checkpointState cache
    let finalizedFoundCheckpointsInStateCache = 0;

    let expectedAttachedValidatorsProposalsCount = 0;
    let finalizedAttachedValidatorsProposalsCount = 0;
    let finalizedAttachedValidatorsOrphanCount = 0;
    let finalizedAttachedValidatorsMissedCount = 0;

    for (const checkpointHex of finalizedProposersCheckpoints) {
      const checkpointState = checkpointStateCache.get(checkpointHex);

      // Generate stats for attached validators if we have state info
      if (checkpointState !== null) {
        finalizedFoundCheckpointsInStateCache++;

        const epochProposers = checkpointState.epochCtx.proposers;
        const startSlot = checkpointState.epochCtx.epoch * SLOTS_PER_EPOCH;

        for (let index = 0; index < epochProposers.length; index++) {
          const slot = startSlot + index;

          // Let skip processing the slots which are out of range
          // Range to consider is:
          //   lastFinalized.epoch * SLOTS_PER_EPOCH + 1, .... finalized.epoch * SLOTS_PER_EPOCH
          if (slot <= lastFinalized.epoch * SLOTS_PER_EPOCH || slot > finalized.epoch * SLOTS_PER_EPOCH) {
            continue;
          }

          const proposer = epochProposers[index];

          // If this proposer was attached to this BN for this epoch
          if (attachedProposers.includes(proposer)) {
            expectedAttachedValidatorsProposalsCount++;

            // Get what validators made canonical/non canonical proposals for this slot
            const {canonicalVals, nonCanonicalVals} = slotProposers.get(slot) ?? {
              canonicalVals: [],
              nonCanonicalVals: [],
            };
            let wasFinalized = false;

            if (canonicalVals.includes(proposer)) {
              finalizedAttachedValidatorsProposalsCount++;
              wasFinalized = true;
            }
            const attachedProposerNonCanSlotProposals = nonCanonicalVals.filter((nonCanVal) => nonCanVal === proposer);
            finalizedAttachedValidatorsOrphanCount += attachedProposerNonCanSlotProposals.length;

            // Check is this slot proposal was missed by this attached validator
            if (!wasFinalized && attachedProposerNonCanSlotProposals.length === 0) {
              finalizedAttachedValidatorsMissedCount++;
            }
          }
        }
      }
    }

    const attachedValidators: ProposalStats = {
      total: expectedAttachedValidatorsProposalsCount,
      finalized: finalizedAttachedValidatorsProposalsCount,
      orphaned: finalizedAttachedValidatorsOrphanCount,
      missed: finalizedAttachedValidatorsMissedCount,
    };

    this.logger.debug("All validators finalized proposal stats", {
      ...allValidators,
      finalizedCanonicalCheckpointsCount,
      finalizedFoundCheckpointsInStateCache,
    });

    // Only log to info if there is some relevant data to show
    //  - No need to explicitly track SYNCED state since no validators attached would be there to show
    //  - debug log if validators attached but no proposals were scheduled
    //  - info log if proposals were scheduled (canonical) or there were orphans (non canonical)
    if (finalizedAttachedValidatorsCount !== 0) {
      const logLevel =
        attachedValidators.total !== 0 || attachedValidators.orphaned !== 0 ? LogLevel.info : LogLevel.debug;
      this.logger[logLevel]("Attached validators finalized proposal stats", {
        ...attachedValidators,
        validators: finalizedAttachedValidatorsCount,
      });
    } else {
      this.logger.debug("No proposers attached to beacon node", {finalizedEpoch: finalized.epoch});
    }

    this.metrics?.allValidators.total.set(allValidators.total);
    this.metrics?.allValidators.finalized.set(allValidators.finalized);
    this.metrics?.allValidators.orphaned.set(allValidators.orphaned);
    this.metrics?.allValidators.missed.set(allValidators.missed);

    this.metrics?.attachedValidators.total.set(attachedValidators.total);
    this.metrics?.attachedValidators.finalized.set(attachedValidators.finalized);
    this.metrics?.attachedValidators.orphaned.set(attachedValidators.orphaned);
    this.metrics?.attachedValidators.missed.set(attachedValidators.missed);

    this.metrics?.finalizedCanonicalCheckpointsCount.set(finalizedCanonicalCheckpointsCount);
    this.metrics?.finalizedFoundCheckpointsInStateCache.set(finalizedFoundCheckpointsInStateCache);
    this.metrics?.finalizedAttachedValidatorsCount.set(finalizedAttachedValidatorsCount);

    // Return stats data for the ease of unit testing
    return {
      allValidators,
      attachedValidators,
      finalizedCanonicalCheckpointsCount,
      finalizedFoundCheckpointsInStateCache,
      finalizedAttachedValidatorsCount,
    };
  }
}
