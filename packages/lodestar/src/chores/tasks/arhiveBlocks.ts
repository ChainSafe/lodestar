import {ITask} from "../interface";
import {IBeaconDb} from "../../db/api";
import {Checkpoint} from "@chainsafe/eth2.0-types";
import {computeEpochOfSlot} from "../../chain/stateTransition/util";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {ILogger} from "../../logger";

export interface IArchiveBlockModules {
  db: IBeaconDb;
  logger: ILogger;
}

/**
 * Archives finalized blocks from active bucket to archive bucket.
 */
export class ArchiveBlocksTask implements ITask {

  private readonly db: IBeaconDb;
  private readonly logger: ILogger;
  private readonly config: IBeaconConfig;

  private finalizedCheckpoint: Checkpoint;

  public constructor(config: IBeaconConfig, modules: IArchiveBlockModules, finalizedCheckpoint: Checkpoint) {
    this.db = modules.db;
    this.logger = modules.logger;
    this.config = config;
    this.finalizedCheckpoint = finalizedCheckpoint;
  }

  public async run(): Promise<void> {
    const blocks = (await this.db.block.getAll()).filter(
      (block) =>
        computeEpochOfSlot(this.config, block.slot) <= this.finalizedCheckpoint.epoch
    );
    this.logger.info(`Started archiving ${blocks.length} finalized blocks...`);
    await Promise.all([
      this.db.blockArchive.addMultiple(blocks),
      this.db.block.deleteManyByValue(blocks)
    ]);
    this.logger.info(`Archiving of ${blocks.length} finalized blocks completed`);
  }



}