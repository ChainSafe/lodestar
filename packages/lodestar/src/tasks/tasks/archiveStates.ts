/**
 * @module tasks
 */

import {ITask} from "../interface";
import {IBeaconDb} from "../../db/api";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {phase0} from "@chainsafe/lodestar-types";
import {IBeaconChain} from "../../chain";

export interface IArchiveStatesModules {
  chain: IBeaconChain;
  db: IBeaconDb;
  logger: ILogger;
}

/**
 * Archives finalized states from active bucket to archive bucket.
 *
 * Only the new finalized state is stored to disk
 */
export class ArchiveStatesTask implements ITask {
  private readonly chain: IBeaconChain;
  private readonly db: IBeaconDb;
  private readonly logger: ILogger;
  private readonly config: IBeaconConfig;

  private finalized: phase0.Checkpoint;

  constructor(config: IBeaconConfig, modules: IArchiveStatesModules, finalized: phase0.Checkpoint) {
    this.chain = modules.chain;
    this.db = modules.db;
    this.logger = modules.logger;
    this.config = config;
    this.finalized = finalized;
  }

  async run(): Promise<void> {
    // store the state of finalized checkpoint
    const finalizedState = this.chain.checkpointStateCache.get(this.finalized);
    if (!finalizedState) {
      throw Error("No state in cache for finalized checkpoint state epoch #" + this.finalized.epoch);
    }
    await this.db.stateArchive.put(finalizedState.slot, finalizedState);
    // don't delete states before the finalized state, auto-prune will take care of it
    this.logger.verbose("Archive states completed", {finalizedEpoch: this.finalized.epoch});
  }
}
