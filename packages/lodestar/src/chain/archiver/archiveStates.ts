/**
 * @module tasks
 */

import {ILogger} from "@chainsafe/lodestar-utils";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconDb} from "../../db";
import {CheckpointStateCache} from "../stateCache";
import {CheckpointWithHex} from "@chainsafe/lodestar-fork-choice";

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

      const storedEpochs = await this.db.stateArchive.keys({
        lt: finalized.epoch,
        // Only check the current and previous intervals
        gte: Math.max(0, (Math.floor(finalized.epoch / PERSIST_STATE_EVERY_EPOCHS) - 1) * PERSIST_STATE_EVERY_EPOCHS),
      });
      const statesToDelete = computeEpochsToDelete(storedEpochs, PERSIST_STATE_EVERY_EPOCHS);
      if (statesToDelete.length > 0) {
        await this.db.stateArchive.batchDelete(statesToDelete);
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
