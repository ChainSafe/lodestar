/**
 * @module tasks
 */

import {ITask} from "../interface";
import {IBeaconDb} from "../../db/api";
import {Checkpoint} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";

export interface IArchiveBlockModules {
  db: IBeaconDb;
  forkChoice: IForkChoice;
  logger: ILogger;
}

/**
 * Archives finalized blocks from active bucket to archive bucket.
 */
export class ArchiveBlocksTask implements ITask {
  private readonly config: IBeaconConfig;
  private readonly db: IBeaconDb;
  private readonly forkChoice: IForkChoice;
  private readonly logger: ILogger;

  private finalized: Checkpoint;

  public constructor(config: IBeaconConfig, modules: IArchiveBlockModules, finalized: Checkpoint) {
    this.config = config;
    this.db = modules.db;
    this.forkChoice = modules.forkChoice;
    this.logger = modules.logger;
    this.finalized = finalized;
  }

  /**
   * Only archive blocks on the same chain to the finalized checkpoint.
   */
  public async run(): Promise<void> {
    this.logger.profile("Archive Blocks");
    const finalizedSlot = computeStartSlotAtEpoch(this.config, this.finalized.epoch);
    const keysToDelete: Uint8Array[] = [];
    let totalArchived = 0;
    for await (const {key, value} of await this.db.block.entriesStream()) {
      if (value.message.slot > finalizedSlot) {
        continue;
      }
      if (this.forkChoice.isDescendant(key, this.finalized.root)) {
        await this.db.blockArchive.add(value);
        totalArchived++;
      }
      keysToDelete.push(key);
    }
    await this.db.block.batchDelete(keysToDelete);
    this.logger.profile("Archive Blocks");
    this.logger.info("Archiving of finalized blocks complete.", {
      totalArchived,
      finalizedEpoch: this.finalized.epoch,
    });
  }
}
