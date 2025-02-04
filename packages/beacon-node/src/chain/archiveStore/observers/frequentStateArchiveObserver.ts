import {CheckpointWithHex, IForkChoice} from "@lodestar/fork-choice";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {CachedBeaconStateAllForks, computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Epoch, Slot} from "@lodestar/types";
import {Checkpoint} from "@lodestar/types/lib/phase0/types.js";
import {Logger} from "@lodestar/utils";
import {IBeaconDb} from "../../../db/index.js";
import {LodestarQueueObserver} from "../../../interface.js";
import {Metrics} from "../../../metrics/metrics.js";
import {AllocSource, BufferPool} from "../../../util/bufferPool.js";
import {getStateSlotFromBytes} from "../../../util/multifork.js";
import {ChainEvent, ChainEventEmitter} from "../../emitter.js";
import {IStateRegenerator} from "../../regen/interface.js";
import {serializeState} from "../../serializeState.js";
import {PROCESS_FINALIZED_CHECKPOINT_QUEUE_LEN} from "../constants.js";
import {ArchiveMode, ArchiveStoreOpts} from "../interface.js";

/**
 * Minimum number of epochs between single temp archived states
 * These states will be pruned once a new state is persisted
 */
export const PERSIST_TEMP_STATE_EVERY_EPOCHS = 32;

export class FrequentStateArchiveObserver extends LodestarQueueObserver<[CheckpointWithHex], void> {
  private prevFinalized: CheckpointWithHex;
  private archiveBlobEpochs?: number;

  constructor(
    private readonly modules: {
      logger: Logger;
      db: IBeaconDb;
      forkChoice: IForkChoice;
      regen: IStateRegenerator;
      bufferPool?: BufferPool | null;
      metrics: Metrics | null;
      getAnchorStateLatestBlockSlot: () => Slot;
    },
    private opts: ArchiveStoreOpts,
    signal: AbortSignal
  ) {
    super({maxQueueLength: PROCESS_FINALIZED_CHECKPOINT_QUEUE_LEN, signal, metrics: modules.metrics});
    this.archiveBlobEpochs = opts.archiveBlobEpochs;
    this.prevFinalized = modules.forkChoice.getFinalizedCheckpoint();

    if (opts.archiveMode !== ArchiveMode.Frequency) {
      throw new Error(
        "DifferentialStateArchiveObserver is only meant to use when archiveMode is ArchiveMode.Frequency"
      );
    }
  }

  subscribe(emitter: ChainEventEmitter): void {
    if (this.opts.disableArchiveOnCheckpoint) return;

    emitter.on(ChainEvent.forkChoiceFinalized, this.onForkChoiceFinalized);
  }

  unsubscribe(emitter: ChainEventEmitter): void {
    emitter.off(ChainEvent.forkChoiceFinalized, this.onForkChoiceFinalized);
  }

  private async onForkChoiceFinalized(checkpoint: CheckpointWithHex): Promise<void> {
    this.processLater(checkpoint);
  }

  /**
   * Persist states every some epochs to
   * - Minimize disk space, storing the least states possible
   * - Minimize the sync progress lost on unexpected crash, storing temp state every few epochs
   *
   * At epoch `e` there will be states peristed at intervals of `PERSIST_STATE_EVERY_EPOCHS` = 32
   * and one at `PERSIST_TEMP_STATE_EVERY_EPOCHS` = 1024
   * ```
   *        |                |             |           .
   * epoch - 1024*2    epoch - 1024    epoch - 32    epoch
   * ```
   */
  protected async processQueueItem(finalized: CheckpointWithHex): Promise<void> {
    try {
      const {rootHex, epoch: finalizedEpoch} = finalized;
      this.modules.logger.verbose("Start processing finalized checkpoint", {
        epoch: finalizedEpoch,
        rootHex: finalized.rootHex,
      });
      this.prevFinalized = finalized;
      const {archiveStateEpochFrequency} = this.opts;
      const lastStoredSlot = await this.modules.db.stateSnapshotArchive.lastKey();
      const lastStoredEpoch = computeEpochAtSlot(lastStoredSlot ?? 0);

      if (finalized.epoch - lastStoredEpoch >= Math.min(PERSIST_TEMP_STATE_EVERY_EPOCHS, archiveStateEpochFrequency)) {
        // starting from Mar 2024, the finalized state could be from disk or in memory
        const finalizedStateOrBytes = await this.modules.regen.getCheckpointStateOrBytes(finalized);
        if (!finalizedStateOrBytes) {
          throw Error(`No state in cache for finalized checkpoint state epoch #${finalized.epoch} root ${rootHex}`);
        }

        if (finalizedStateOrBytes instanceof Uint8Array) {
          const slot = getStateSlotFromBytes(finalizedStateOrBytes);
          await this.modules.db.stateSnapshotArchive.putBinary(slot, finalizedStateOrBytes);
          this.modules.logger.verbose("Archived finalized state bytes", {epoch: finalized.epoch, slot, root: rootHex});
        } else {
          // serialize state using BufferPool if provided
          const timer = this.metrics?.stateSerializeDuration.startTimer({source: AllocSource.ARCHIVE_STATE});
          await serializeState(
            finalizedStateOrBytes,
            AllocSource.ARCHIVE_STATE,
            (stateBytes) => {
              timer?.();
              return this.modules.db.stateSnapshotArchive.putBinary(finalizedStateOrBytes.slot, stateBytes);
            },
            this.modules.bufferPool
          );
          // don't delete states before the finalized state, auto-prune will take care of it
          this.modules.logger.verbose("Archived finalized state", {
            epoch: finalized.epoch,
            slot: finalizedStateOrBytes.slot,
            root: rootHex,
          });
        }

        // Only check the current and previous intervals
        const minEpoch = Math.max(
          0,
          (Math.floor(finalized.epoch / archiveStateEpochFrequency) - 1) * archiveStateEpochFrequency
        );

        const storedStateSlots = await this.modules.db.stateSnapshotArchive.keys({
          lt: computeStartSlotAtEpoch(finalized.epoch),
          gte: computeStartSlotAtEpoch(minEpoch),
        });

        const statesSlotsToDelete = computeStateSlotsToDelete(storedStateSlots, archiveStateEpochFrequency);
        if (statesSlotsToDelete.length > 0) {
          await this.modules.db.stateSnapshotArchive.batchDelete(statesSlotsToDelete);
        }

        // More logs to investigate the rss spike issue https://github.com/ChainSafe/lodestar/issues/5591
        this.modules.logger.verbose("Archived state completed", {
          finalizedEpoch: finalized.epoch,
          minEpoch,
          storedStateSlots: storedStateSlots.join(","),
          statesSlotsToDelete: statesSlotsToDelete.join(","),
        });
      }

      this.modules.regen.pruneOnFinalized(finalizedEpoch);

      // tasks rely on extended fork choice
      const prunedBlocks = this.modules.forkChoice.prune(finalized.rootHex);
      await this.updateBackfillRange(finalized);

      this.modules.logger.verbose("Finish processing finalized checkpoint", {
        epoch: finalizedEpoch,
        rootHex: finalized.rootHex,
        prunedBlocks: prunedBlocks.length,
      });
    } catch (e) {
      this.modules.logger.error("Error processing finalized checkpoint", {epoch: finalized.epoch}, e as Error);
    }
  }

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
      const finalizedBlockFC = this.modules.forkChoice.getBlockHex(finalized.rootHex);
      const anchorStateLatestBlockSlot = this.modules.getAnchorStateLatestBlockSlot();

      if (finalizedBlockFC && finalizedBlockFC.slot > anchorStateLatestBlockSlot) {
        await this.modules.db.backfilledRanges.put(finalizedBlockFC.slot, anchorStateLatestBlockSlot);

        // Clear previously marked sequence till anchorStateLatestBlockSlot, without
        // touching backfill sync process sequence which are at
        // <=anchorStateLatestBlockSlot i.e. clear >anchorStateLatestBlockSlot
        // and < currentSlot
        const filteredSeqs = await this.modules.db.backfilledRanges.entries({
          gt: this.modules.getAnchorStateLatestBlockSlot(),
          lt: finalizedBlockFC.slot,
        });
        this.modules.logger.debug("updated backfilledRanges", {
          key: finalizedBlockFC.slot,
          value: anchorStateLatestBlockSlot,
        });
        if (filteredSeqs.length > 0) {
          await this.modules.db.backfilledRanges.batchDelete(filteredSeqs.map((entry) => entry.key));
          this.modules.logger.debug(
            `Forward Sync - cleaned up backfilledRanges between ${finalizedBlockFC.slot},${anchorStateLatestBlockSlot}`,
            {seqs: JSON.stringify(filteredSeqs)}
          );
        }
      }
    } catch (e) {
      this.modules.logger.error(
        "Error updating backfilledRanges on finalization",
        {epoch: finalized.epoch},
        e as Error
      );
    }
  };
}

/**
 * Keeps first epoch per interval of persistEveryEpochs, deletes the rest
 */
export function computeStateSlotsToDelete(storedStateSlots: Slot[], persistEveryEpochs: Epoch): Slot[] {
  const persistEverySlots = persistEveryEpochs * SLOTS_PER_EPOCH;
  const intervalsWithStates = new Set<number>();
  const stateSlotsToDelete = new Set<number>();

  for (const slot of storedStateSlots) {
    const interval = Math.floor(slot / persistEverySlots);
    if (intervalsWithStates.has(interval)) {
      stateSlotsToDelete.add(slot);
    } else {
      intervalsWithStates.add(interval);
    }
  }

  return Array.from(stateSlotsToDelete.values());
}
