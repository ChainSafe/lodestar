import {Slot} from "@lodestar/types";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {CheckpointWithHex} from "@lodestar/fork-choice";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {IBeaconDb} from "../../db/index.js";

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
export async function maybeArchiveState(
  db: IBeaconDb,
  finalizedState: CachedBeaconStateAllForks,
  finalized: CheckpointWithHex
): Promise<{archivedState: boolean; deletedSlots: Slot[]}> {
  const lastStoredSlot = await db.stateArchive.lastKey();
  const lastStoredEpoch = computeEpochAtSlot(lastStoredSlot ?? 0);

  if (finalized.epoch - lastStoredEpoch > PERSIST_TEMP_STATE_EVERY_EPOCHS) {
    await db.stateArchive.put(finalizedState.slot, finalizedState);

    const fromEpoch = computeStartSlotAtEpoch(finalized.epoch);
    // Only check the current and previous intervals
    const toEpoch = Math.max(
      0,
      (Math.floor(finalized.epoch / PERSIST_STATE_EVERY_EPOCHS) - 1) * PERSIST_STATE_EVERY_EPOCHS
    );

    const storedStateSlots = await db.stateArchive.keys({
      lte: computeStartSlotAtEpoch(fromEpoch),
      gte: computeStartSlotAtEpoch(toEpoch),
    });

    const statesSlotsToDelete = computeStateSlotsToDelete(storedStateSlots, PERSIST_STATE_EVERY_EPOCHS);
    if (statesSlotsToDelete.length > 0) {
      await db.stateArchive.batchDelete(statesSlotsToDelete);
    }

    return {archivedState: true, deletedSlots: statesSlotsToDelete};
  }

  // Don't archive finalized state
  else {
    return {archivedState: false, deletedSlots: []};
  }
}

/**
 * Keeps first epoch per interval of persistEveryEpochs, deletes the rest
 */
export function computeStateSlotsToDelete(storedStateSlots: number[], persistEveryEpochs: number): number[] {
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
