import {CheckpointWithHex} from "@lodestar/fork-choice";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Epoch, Slot} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {IBeaconDb} from "../../../db/index.js";
import {Metrics} from "../../../metrics/metrics.js";
import {AllocSource, BufferPool} from "../../../util/bufferPool.js";
import {getStateSlotFromBytes} from "../../../util/multifork.js";
import {IStateRegenerator} from "../../regen/interface.js";
import {serializeState} from "../../serializeState.js";

/**
 * Minimum number of epochs between single temp archived states
 * These states will be pruned once a new state is persisted
 */
export const PERSIST_TEMP_STATE_EVERY_EPOCHS = 32;

type FrequentArchiveModules = {
  db: IBeaconDb;
  metrics?: Metrics | null;
  logger: Logger;
  bufferPool: BufferPool;
  regen: IStateRegenerator;
};

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
  modules: FrequentArchiveModules,
  opts: {archiveStateEpochFrequency: number},
  finalized: CheckpointWithHex
): Promise<void> {
  const {db, logger} = modules;
  const {archiveStateEpochFrequency} = opts;

  const lastStoredSlot = await db.stateArchive.lastKey();
  const lastStoredEpoch = computeEpochAtSlot(lastStoredSlot ?? 0);

  if (finalized.epoch - lastStoredEpoch >= Math.min(PERSIST_TEMP_STATE_EVERY_EPOCHS, archiveStateEpochFrequency)) {
    await archiveState(modules, finalized);

    // Only check the current and previous intervals
    const minEpoch = Math.max(
      0,
      (Math.floor(finalized.epoch / archiveStateEpochFrequency) - 1) * archiveStateEpochFrequency
    );

    const storedStateSlots = await db.stateArchive.keys({
      lt: computeStartSlotAtEpoch(finalized.epoch),
      gte: computeStartSlotAtEpoch(minEpoch),
    });

    const statesSlotsToDelete = computeStateSlotsToDelete(storedStateSlots, archiveStateEpochFrequency);
    if (statesSlotsToDelete.length > 0) {
      await db.stateArchive.batchDelete(statesSlotsToDelete);
    }

    // More logs to investigate the rss spike issue https://github.com/ChainSafe/lodestar/issues/5591
    logger.verbose("Archived state completed", {
      finalizedEpoch: finalized.epoch,
      minEpoch,
      storedStateSlots: storedStateSlots.join(","),
      statesSlotsToDelete: statesSlotsToDelete.join(","),
    });
  }
}

/**
 * Archives finalized states from active bucket to archive bucket.
 * Only the new finalized state is stored to disk
 */
export async function archiveState(modules: FrequentArchiveModules, finalized: CheckpointWithHex): Promise<void> {
  const {db, metrics, logger, regen, bufferPool} = modules;

  // starting from Mar 2024, the finalized state could be from disk or in memory
  const finalizedStateOrBytes = await regen.getCheckpointStateOrBytes(finalized);
  const {rootHex} = finalized;
  if (!finalizedStateOrBytes) {
    throw Error(`No state in cache for finalized checkpoint state epoch #${finalized.epoch} root ${rootHex}`);
  }
  if (finalizedStateOrBytes instanceof Uint8Array) {
    const slot = getStateSlotFromBytes(finalizedStateOrBytes);
    await db.stateArchive.putBinary(slot, finalizedStateOrBytes);
    logger.verbose("Archived finalized state bytes", {epoch: finalized.epoch, slot, root: rootHex});
  } else {
    // serialize state using BufferPool if provided
    const timer = metrics?.stateSerializeDuration.startTimer({source: AllocSource.ARCHIVE_STATE});
    await serializeState(
      finalizedStateOrBytes,
      AllocSource.ARCHIVE_STATE,
      (stateBytes) => {
        timer?.();
        return db.stateArchive.putBinary(finalizedStateOrBytes.slot, stateBytes);
      },
      bufferPool
    );
    // don't delete states before the finalized state, auto-prune will take care of it
    logger.verbose("Archived finalized state", {
      epoch: finalized.epoch,
      slot: finalizedStateOrBytes.slot,
      root: rootHex,
    });
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
