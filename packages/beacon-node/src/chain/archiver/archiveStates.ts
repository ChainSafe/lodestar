import {ILogger} from "@lodestar/utils";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Slot, Epoch} from "@lodestar/types";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {CheckpointWithHex} from "@lodestar/fork-choice";
import {IBeaconDb} from "../../db/index.js";
import {CheckpointStateCache} from "../stateCache/index.js";

/**
 * Minimum number of epochs between archived states
 */
export const PERSIST_STATE_EVERY_EPOCHS = 1024;
/**
 * Minimum number of epochs between single temp archived states
 * These states will be pruned once a new state is persisted
 */
const PERSIST_TEMP_STATE_EVERY_EPOCHS = 32;

/**
 * Archives finalized states from active bucket to archive bucket.
 *
 * Only the new finalized state is stored to disk
 */
export class StatesArchiver {
  constructor(
    private readonly checkpointStateCache: CheckpointStateCache,
    private readonly db: IBeaconDb,
    private readonly logger: ILogger
  ) {}

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
  async maybeArchiveState(finalized: CheckpointWithHex): Promise<void> {
    const lastStoredSlot = await this.db.stateArchive.lastKey();
    const lastStoredEpoch = computeEpochAtSlot(lastStoredSlot ?? 0);

    if (finalized.epoch - lastStoredEpoch > PERSIST_TEMP_STATE_EVERY_EPOCHS) {
      await this.archiveState(finalized);

      // Only check the current and previous intervals
      const minEpoch = Math.max(
        0,
        (Math.floor(finalized.epoch / PERSIST_STATE_EVERY_EPOCHS) - 1) * PERSIST_STATE_EVERY_EPOCHS
      );

      const storedStateSlots = await this.db.stateArchive.keys({
        lt: computeStartSlotAtEpoch(finalized.epoch),
        gte: computeStartSlotAtEpoch(minEpoch),
      });

      const statesSlotsToDelete = computeStateSlotsToDelete(storedStateSlots, PERSIST_STATE_EVERY_EPOCHS);
      if (statesSlotsToDelete.length > 0) {
        await this.db.stateArchive.batchDelete(statesSlotsToDelete);
      }
    }
  }

  /**
   * Archives finalized states from active bucket to archive bucket.
   * Only the new finalized state is stored to disk
   */
  async archiveState(finalized: CheckpointWithHex): Promise<void> {
    const finalizedState = this.checkpointStateCache.get(finalized);
    if (!finalizedState) {
      throw Error("No state in cache for finalized checkpoint state epoch #" + finalized.epoch);
    }
    await this.db.stateArchive.put(finalizedState.slot, finalizedState);
    // don't delete states before the finalized state, auto-prune will take care of it
    this.logger.verbose("Archive states completed", {finalizedEpoch: finalized.epoch});
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
