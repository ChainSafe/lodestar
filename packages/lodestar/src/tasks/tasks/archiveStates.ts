/**
 * @module tasks
 */

import {ITask} from "../interface";
import {IBeaconDb} from "../../db/api";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {Checkpoint} from "@chainsafe/lodestar-types";

export interface IArchiveStatesModules {
  db: IBeaconDb;
  logger: ILogger;
}

/**
 * Archives finalized states from active bucket to archive bucket.
 *
 * Only the new finalized state is stored to disk
 */
export class ArchiveStatesTask implements ITask {
  private readonly db: IBeaconDb;
  private readonly logger: ILogger;
  private readonly config: IBeaconConfig;

  private finalized: Checkpoint;

  public constructor(config: IBeaconConfig, modules: IArchiveStatesModules, finalized: Checkpoint) {
    this.db = modules.db;
    this.logger = modules.logger;
    this.config = config;
    this.finalized = finalized;
  }

  public async run(): Promise<void> {
    this.logger.info(`Started archiving states (finalized epoch #${this.finalized.epoch})...`);
    this.logger.profile("Archive States");
    // store the state of finalized checkpoint
    const stateCache = await this.db.checkpointStateCache.get(this.finalized);
    if (!stateCache) {
      throw Error("No state in cache for finalized checkpoint state");
    }
    const finalizedState = stateCache.state;
    await this.db.stateArchive.add(finalizedState);
    // don't delete states before the finalized state, auto-prune will take care of it
    this.logger.info(`Archiving of finalized states completed (finalized epoch #${this.finalized.epoch})`);
    this.logger.profile("Archive States");
  }
}
