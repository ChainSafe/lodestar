/**
 * @module tasks
 */

import {ITask} from "../interface";
import {IBeaconDb} from "../../db/api";
import {Checkpoint} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from  "@chainsafe/lodestar-utils/lib/logger";

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

  private finalizedCheckpoint: Checkpoint;

  public constructor(config: IBeaconConfig, modules: IArchiveStatesModules, finalizedCheckpoint: Checkpoint) {
    this.db = modules.db;
    this.logger = modules.logger;
    this.config = config;
    this.finalizedCheckpoint = finalizedCheckpoint;
  }

  public async run(): Promise<void> {
    this.logger.info(
      `Started archiving states (finalized epoch #${this.finalizedCheckpoint.epoch})...`
    );
    this.logger.profile("Archieve States");
    // store the state of finalized checkpoint
    const finalizedState = (await this.db.stateCache.firstStateOfEpoch(this.finalizedCheckpoint.epoch)).state;
    await this.db.stateArchive.add(finalizedState);
    // delete states before the finalized state
    this.db.stateCache.prune(finalizedState.slot);
    this.logger.info(
      `Archiving of finalized states completed (finalized epoch #${this.finalizedCheckpoint.epoch})`);
    this.logger.profile("Archieve States");
  }
}
