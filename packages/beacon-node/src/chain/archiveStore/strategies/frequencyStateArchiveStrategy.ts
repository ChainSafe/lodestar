import {CheckpointWithHex} from "@lodestar/fork-choice";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Epoch, RootHex, Slot} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {IBeaconDb} from "../../../db/index.js";
import {Metrics} from "../../../metrics/metrics.js";
import {AllocSource, BufferPool} from "../../../util/bufferPool.js";
import {getStateSlotFromBytes} from "../../../util/multifork.js";
import {IStateRegenerator} from "../../regen/interface.js";
import {serializeState} from "../../serializeState.js";
import {StateArchiveStrategy, StatesArchiveOpts} from "../interface.js";

/**
 * Minimum number of epochs between single temp archived states
 * These states will be pruned once a new state is persisted
 */
export const PERSIST_TEMP_STATE_EVERY_EPOCHS = 32;

export enum FrequencyStateArchiveStep {
  LoadLastStoredSlot = "load_last_stored_slot",
  GetFinalizedState = "get_finalized_state",
  // SerializeState is tracked via stateSerializeDuration metric
  PersistState = "persist_state",
  LoadStoredSlotsToDelete = "load_stored_slots_to_delete",
  DeleteOldStates = "delete_old_states",
}

/**
 * Archives finalized states from active bucket to archive bucket.
 *
 * Only the new finalized state is stored to disk
 */
export class FrequencyStateArchiveStrategy implements StateArchiveStrategy {
  constructor(
    private readonly regen: IStateRegenerator,
    private readonly db: IBeaconDb,
    private readonly logger: Logger,
    private readonly opts: StatesArchiveOpts,
    private readonly bufferPool?: BufferPool | null
  ) {}

  async onFinalizedCheckpoint(_finalized: CheckpointWithHex, _metrics?: Metrics | null): Promise<void> {}
  async onCheckpoint(_stateRoot: RootHex, _metrics?: Metrics | null): Promise<void> {}

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
  async maybeArchiveState(finalized: CheckpointWithHex, metrics?: Metrics | null): Promise<void> {
    let timer = metrics?.processFinalizedCheckpoint.frequencyStateArchive.startTimer();
    const lastStoredSlot = await this.db.stateArchive.lastKey();
    timer?.({step: FrequencyStateArchiveStep.LoadLastStoredSlot});

    const lastStoredEpoch = computeEpochAtSlot(lastStoredSlot ?? 0);
    const {archiveStateEpochFrequency} = this.opts;

    const logCtx = {finalizedEpoch: finalized.epoch, lastStoredEpoch, archiveStateEpochFrequency};
    if (finalized.epoch - lastStoredEpoch >= Math.min(PERSIST_TEMP_STATE_EVERY_EPOCHS, archiveStateEpochFrequency)) {
      this.logger.verbose("Start archiving state", logCtx);
      await this.archiveState(finalized, metrics);

      // Only check the current and previous intervals
      const minEpoch = Math.max(
        0,
        (Math.floor(finalized.epoch / archiveStateEpochFrequency) - 1) * archiveStateEpochFrequency
      );

      timer = metrics?.processFinalizedCheckpoint.frequencyStateArchive.startTimer();
      const storedStateSlots = await this.db.stateArchive.keys({
        lt: computeStartSlotAtEpoch(finalized.epoch),
        gte: computeStartSlotAtEpoch(minEpoch),
      });
      timer?.({step: FrequencyStateArchiveStep.LoadStoredSlotsToDelete});

      const statesSlotsToDelete = computeStateSlotsToDelete(storedStateSlots, archiveStateEpochFrequency);
      timer = metrics?.processFinalizedCheckpoint.frequencyStateArchive.startTimer();
      if (statesSlotsToDelete.length > 0) {
        await this.db.stateArchive.batchDelete(statesSlotsToDelete);
      }
      timer?.({step: FrequencyStateArchiveStep.DeleteOldStates});

      // More logs to investigate the rss spike issue https://github.com/ChainSafe/lodestar/issues/5591
      this.logger.verbose("Archived state completed", {
        ...logCtx,
        minEpoch,
        storedStateSlots: storedStateSlots.join(","),
        statesSlotsToDelete: statesSlotsToDelete.join(","),
      });
    } else {
      this.logger.verbose("Skip archiving state", logCtx);
    }
  }

  /**
   * Archives finalized states from active bucket to archive bucket.
   * Only the new finalized state is stored to disk
   */
  async archiveState(finalized: CheckpointWithHex, metrics?: Metrics | null): Promise<void> {
    // starting from Mar 2024, the finalized state could be from disk or in memory
    let timer = metrics?.processFinalizedCheckpoint.frequencyStateArchive.startTimer();
    const finalizedStateOrBytes = await this.regen.getCheckpointStateOrBytes(finalized);
    timer?.({step: FrequencyStateArchiveStep.GetFinalizedState});

    const {rootHex} = finalized;
    if (!finalizedStateOrBytes) {
      throw Error(`No state in cache for finalized checkpoint state epoch #${finalized.epoch} root ${rootHex}`);
    }
    if (finalizedStateOrBytes instanceof Uint8Array) {
      const slot = getStateSlotFromBytes(finalizedStateOrBytes);
      timer = metrics?.processFinalizedCheckpoint.frequencyStateArchive.startTimer();
      await this.db.stateArchive.putBinary(slot, finalizedStateOrBytes);
      timer?.({step: FrequencyStateArchiveStep.PersistState});
      this.logger.verbose("Archived finalized state bytes", {epoch: finalized.epoch, slot, root: rootHex});
    } else {
      // serialize state using BufferPool if provided
      const sszTimer = metrics?.stateSerializeDuration.startTimer({source: AllocSource.ARCHIVE_STATE});
      await serializeState(
        finalizedStateOrBytes,
        AllocSource.ARCHIVE_STATE,
        async (stateBytes) => {
          sszTimer?.();
          timer = metrics?.processFinalizedCheckpoint.frequencyStateArchive.startTimer();
          await this.db.stateArchive.putBinary(finalizedStateOrBytes.slot, stateBytes);
          timer?.({step: FrequencyStateArchiveStep.PersistState});
        },
        this.bufferPool
      );
      // don't delete states before the finalized state, auto-prune will take care of it
      this.logger.verbose("Archived finalized state", {
        epoch: finalized.epoch,
        slot: finalizedStateOrBytes.slot,
        root: rootHex,
      });
    }
  }
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
