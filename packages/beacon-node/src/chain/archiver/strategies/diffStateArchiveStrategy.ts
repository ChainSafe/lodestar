import {CheckpointWithHex} from "@lodestar/fork-choice";
import {RootHex} from "@lodestar/types";
import {Metrics} from "../../../metrics/metrics.js";
import {StateArchiveStrategy, StatesArchiverOpts} from "../interface.js";
import {IStateRegenerator} from "../../regen/interface.js";
import {IBeaconDb} from "../../../db/interface.js";
import {Logger} from "@lodestar/logger";
import {BufferPool} from "../../../util/bufferPool.js";
import {IHistoricalStateRegen} from "../../historicalState/types.js";
import {CachedBeaconStateAllForks, computeStartSlotAtEpoch} from "@lodestar/state-transition";

export class DifferentialStateArchiveStrategy implements StateArchiveStrategy {
  constructor(
    private readonly historicalStateRegen: IHistoricalStateRegen | undefined,
    private readonly regen: IStateRegenerator,
    private readonly db: IBeaconDb,
    private readonly logger: Logger,
    private readonly opts: StatesArchiverOpts,
    private readonly bufferPool?: BufferPool | null
  ) {}

  onCheckpoint(_stateRoot: RootHex, _metrics?: Metrics | null): Promise<void> {
    throw new Error("Method not implemented.");
  }

  onFinalizedCheckpoint(_finalized: CheckpointWithHex, _metrics?: Metrics | null): Promise<void> {
    throw new Error("Method not implemented.");
  }

  async maybeArchiveState(finalized: CheckpointWithHex): Promise<void> {
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
