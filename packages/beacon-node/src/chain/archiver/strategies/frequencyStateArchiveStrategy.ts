import {CheckpointWithHex} from "@lodestar/fork-choice";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {CachedBeaconStateElectra, computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Epoch, RootHex, Slot} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {IBeaconDb} from "../../../db/index.js";
import {Metrics} from "../../../metrics/metrics.js";
import {AllocSource, BufferPool} from "../../../util/bufferPool.js";
import {getStateSlotFromBytes} from "../../../util/multifork.js";
import {IStateRegenerator} from "../../regen/interface.js";
import {serializeState} from "../../serializeState.js";
import {StateArchiveStrategy, StatesArchiverOpts} from "../interface.js";

/**
 * Minimum number of epochs between single temp archived states
 * These states will be pruned once a new state is persisted
 */
export const PERSIST_TEMP_STATE_EVERY_EPOCHS = 32;

enum PersistSnapshotResult {
  NoTreeBackedState = "no_tree_backed_state",
  NoDepositEvent = "no_deposit_event",
  NotSyncedDepositRootTree = "not_synced_deposit_root_tree",
  Success = "success",
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
    private readonly opts: StatesArchiverOpts,
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
    const lastStoredSlot = await this.db.stateArchive.lastKey();
    const lastStoredEpoch = computeEpochAtSlot(lastStoredSlot ?? 0);
    const {archiveStateEpochFrequency} = this.opts;

    if (finalized.epoch - lastStoredEpoch >= Math.min(PERSIST_TEMP_STATE_EVERY_EPOCHS, archiveStateEpochFrequency)) {
      await this.archiveState(finalized, metrics);

      // Only check the current and previous intervals
      const minEpoch = Math.max(
        0,
        (Math.floor(finalized.epoch / archiveStateEpochFrequency) - 1) * archiveStateEpochFrequency
      );

      const storedStateSlots = await this.db.stateArchive.keys({
        lt: computeStartSlotAtEpoch(finalized.epoch),
        gte: computeStartSlotAtEpoch(minEpoch),
      });

      const statesSlotsToDelete = computeStateSlotsToDelete(storedStateSlots, archiveStateEpochFrequency);
      if (statesSlotsToDelete.length > 0) {
        await this.db.stateArchive.batchDelete(statesSlotsToDelete);
      }

      // More logs to investigate the rss spike issue https://github.com/ChainSafe/lodestar/issues/5591
      this.logger.verbose("Archived state completed", {
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
  async archiveState(finalized: CheckpointWithHex, metrics?: Metrics | null): Promise<void> {
    // starting from Mar 2024, the finalized state could be from disk or in memory
    const finalizedStateOrBytes = await this.regen.getCheckpointStateOrBytes(finalized);
    const {rootHex} = finalized;
    if (!finalizedStateOrBytes) {
      throw Error(`No state in cache for finalized checkpoint state epoch #${finalized.epoch} root ${rootHex}`);
    }
    if (finalizedStateOrBytes instanceof Uint8Array) {
      const slot = getStateSlotFromBytes(finalizedStateOrBytes);
      await this.db.stateArchive.putBinary(slot, finalizedStateOrBytes);
      this.logger.verbose("Archived finalized state bytes", {epoch: finalized.epoch, slot, root: rootHex});
    } else {
      // serialize state using BufferPool if provided
      const timer = metrics?.stateSerializeDuration.startTimer({source: AllocSource.ARCHIVE_STATE});
      await serializeState(
        finalizedStateOrBytes,
        AllocSource.ARCHIVE_STATE,
        (stateBytes) => {
          timer?.();
          return this.db.stateArchive.putBinary(finalizedStateOrBytes.slot, stateBytes);
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

  async persistDepositTreeSnapshot(finalized: CheckpointWithHex, metrics?: Metrics | null): Promise<number> {
    // starting from Mar 2024, the finalized state could be from disk or in memory
    const finalizedState = await this.regen.getCheckpointStateOrBytes(finalized);
    const {rootHex} = finalized;
    if (!finalizedState) {
      throw Error(`No state in cache for finalized checkpoint state epoch #${finalized.epoch} root ${rootHex}`);
    }

    if (finalizedState instanceof Uint8Array) {
      // with the current DEFAULT_MAX_CP_STATE_EPOCHS_IN_MEMORY = 3, it's most likely the state is in memory
      // it's not worth to reload the state from disk just to persist snapshot
      // in this case, we should be able to server snapshot api using the old snapshot
      // the next time the network is stable, we should be able to persist the new snapshot
      metrics?.eth1.persistSnapshotResult.inc({result: PersistSnapshotResult.NoTreeBackedState});
      throw Error("Finalized state is not in cache");
    }

    const eth1Data = finalizedState.eth1Data;
    const finalizedDepositCount = eth1Data.depositCount;

    if (
      finalizedState.epochCtx.isPostElectra() &&
      finalizedState.eth1DepositIndex >= (finalizedState as CachedBeaconStateElectra).depositRequestsStartIndex
    ) {
      // No need to poll eth1Data since Electra deprecates the mechanism after depositRequestsStartIndex is reached
      return finalizedDepositCount;
    }

    metrics?.eth1.finalizedDepositCount.set(finalizedDepositCount);
    const lastFinalizedDepositEvent = await this.db.depositEvent.get(finalizedDepositCount - 1);
    if (lastFinalizedDepositEvent == null) {
      // ignore if we our depositEvent db is not synced
      metrics?.eth1.persistSnapshotResult.inc({result: PersistSnapshotResult.NoDepositEvent});
      throw Error(`No deposit event found for index ${finalizedDepositCount - 1}`);
    }

    const persistSuccess = await this.db.depositDataRoot.onFinalizedEth1Data(
      eth1Data,
      lastFinalizedDepositEvent.blockNumber
    );
    if (!persistSuccess) {
      metrics?.eth1.persistSnapshotResult.inc({result: PersistSnapshotResult.NotSyncedDepositRootTree});
    } else {
      metrics?.eth1.persistSnapshotResult.inc({result: PersistSnapshotResult.Success});
    }

    return finalizedDepositCount;
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
