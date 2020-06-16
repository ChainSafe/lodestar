/**
 * @module tasks
 */

import {ITask} from "../interface";
import {IBeaconDb} from "../../db/api";
import {Checkpoint} from "@chainsafe/lodestar-types";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {bigIntArrayMax, bigIntArrayMin} from "@chainsafe/lodestar-utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from  "@chainsafe/lodestar-utils/lib/logger";

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
    const blocks = (await this.db.block.values()).filter(
      (block) =>
        computeEpochAtSlot(this.config, block.message.slot) < this.finalizedCheckpoint.epoch
    );
    const fromSlot = blocks.length > 0? bigIntArrayMin(...blocks.map(block => block.message.slot)) : undefined;
    const toSlot = blocks.length > 0? bigIntArrayMax(...blocks.map(block => block.message.slot)) : undefined;
    this.logger.info(`Started archiving ${blocks.length} blocks from slot ${fromSlot} to ${toSlot}`
        +`(finalized epoch #${this.finalizedCheckpoint.epoch})...`
    );
    await Promise.all([
      this.db.blockArchive.batchAdd(blocks),
      this.db.block.batchRemove(blocks)
    ]);
    this.logger.info(`Archiving of ${blocks.length} finalized blocks from slot ${fromSlot} to ${toSlot} completed `
        + `(finalized epoch #${this.finalizedCheckpoint.epoch})`);
  }
}
