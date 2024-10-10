import {CheckpointWithHex} from "@lodestar/fork-choice";
import {Logger} from "@lodestar/utils";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {IBeaconDb} from "../../db/index.js";
import {IStateRegenerator} from "../regen/interface.js";
import {IHistoricalStateRegen} from "../historicalState/types.js";

export interface StatesArchiverOpts {}

/**
 * Archives finalized states from active bucket to archive bucket.
 *
 * Only the new finalized state is stored to disk
 */
export class StatesArchiver {
  constructor(
    private readonly historicalStateRegen: IHistoricalStateRegen | undefined,
    private readonly regen: IStateRegenerator,
    private readonly db: IBeaconDb,
    private readonly logger: Logger,
    private readonly opts: StatesArchiverOpts
  ) {}

  async maybeArchiveState(finalized: CheckpointWithHex): Promise<void> {
    await this.archiveState(finalized);
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
