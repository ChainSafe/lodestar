import {Slot} from "@lodestar/types";
import {computeEpochAtSlot} from "@lodestar/state-transition";
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
): Promise<{archivedState: boolean; deletedEpochs: Slot[]}> {
  const lastStoredSlot = await db.stateArchive.lastKey();
  const lastStoredEpoch = computeEpochAtSlot(lastStoredSlot ?? 0);

  if (finalized.epoch - lastStoredEpoch > PERSIST_TEMP_STATE_EVERY_EPOCHS) {
    await db.stateArchive.put(finalizedState.slot, finalizedState);

    // HEEEEEYYY!!: `db.stateArchive` indexes by slot or epoch?? Mixed use
    const storedEpochs = await db.stateArchive.keys({
      lt: finalized.epoch,
      // Only check the current and previous intervals
      gte: Math.max(0, (Math.floor(finalized.epoch / PERSIST_STATE_EVERY_EPOCHS) - 1) * PERSIST_STATE_EVERY_EPOCHS),
    });
    const statesToDelete = computeEpochsToDelete(storedEpochs, PERSIST_STATE_EVERY_EPOCHS);
    if (statesToDelete.length > 0) {
      await db.stateArchive.batchDelete(statesToDelete);
    }

    return {archivedState: true, deletedEpochs: statesToDelete};
  }

  // Don't archive finalized state
  else {
    return {archivedState: false, deletedEpochs: []};
  }
}

/**
 * Keeps first epoch per interval of persistEveryEpochs, deletes the rest
 */
export function computeEpochsToDelete(storedEpochs: number[], persistEveryEpochs: number): number[] {
  const epochBuckets = new Set<number>();
  const toDelete = new Set<number>();
  for (const epoch of storedEpochs) {
    const epochBucket = epoch - (epoch % persistEveryEpochs);
    if (epochBuckets.has(epochBucket)) {
      toDelete.add(epoch);
    } else {
      epochBuckets.add(epochBucket);
    }
  }

  return Array.from(toDelete.values());
}
