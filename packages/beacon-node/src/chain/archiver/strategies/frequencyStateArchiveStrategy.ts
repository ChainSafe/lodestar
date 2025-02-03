import {CheckpointWithHex} from "@lodestar/fork-choice";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {RootHex} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {IBeaconDb} from "../../../db/index.js";
import {Metrics} from "../../../metrics/metrics.js";
import {IStateRegenerator} from "../../regen/interface.js";
import {StateArchiveStrategy, StatesArchiverOpts} from "../interface.js";
import { IHistoricalStateRegen } from "../../historicalState/types.js";

/**
 * Minimum number of epochs between single temp archived states
 * These states will be pruned once a new state is persisted
 */
export const PERSIST_TEMP_STATE_EVERY_EPOCHS = 32;

/**
 * Archives finalized states from active bucket to archive bucket.
 *
 * Only the new finalized state is stored to disk
 */
export class FrequencyStateArchiveStrategy implements StateArchiveStrategy {
  constructor(
    private readonly historicalStateRegen: IHistoricalStateRegen | undefined,
    private readonly regen: IStateRegenerator,
    private readonly db: IBeaconDb,
    private readonly logger: Logger,
    private readonly opts: StatesArchiverOpts
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
  async archiveState(finalized: CheckpointWithHex): Promise<void> {
    // starting from Mar 2024, the finalized state could be from disk or in memory
    const state = await this.regen.getCheckpointStateOrBytes(finalized);
    if (state === null) {
      this.logger.warn("Checkpoint state not available to archive.", {epoch: finalized.epoch, root: finalized.rootHex});
      return;
    }

    if (Array.isArray(state) && state.constructor === Uint8Array) {
      return this.historicalStateRegen?.storeHistoricalState(computeStartSlotAtEpoch(finalized.epoch), state);
    }

    return this.historicalStateRegen?.storeHistoricalState(
      (state as CachedBeaconStateAllForks).slot,
      (state as CachedBeaconStateAllForks).serialize()
    );
  }
}
