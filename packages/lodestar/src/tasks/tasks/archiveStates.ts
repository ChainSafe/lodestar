/**
 * @module tasks
 */

import {ITask} from "../interface";
import {IBeaconDb} from "../../db/api";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from  "@chainsafe/lodestar-utils/lib/logger";
import {BlockSummary} from "../../chain";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";

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

  private finalized: BlockSummary;
  private pruned: BlockSummary[];

  public constructor(
    config: IBeaconConfig, modules: IArchiveStatesModules, finalized: BlockSummary, pruned: BlockSummary[]) {
    this.db = modules.db;
    this.logger = modules.logger;
    this.config = config;
    this.finalized = finalized;
    this.pruned = pruned;
  }

  public async run(): Promise<void> {
    const epoch = computeEpochAtSlot(this.config, this.finalized.slot);
    this.logger.info(
      `Started archiving states (finalized epoch #${epoch})...`
    );
    this.logger.profile("Archive States");
    // store the state of finalized checkpoint
    const finalizedState = (await this.db.stateCache.get(this.finalized.stateRoot)).state;
    await this.db.stateArchive.add(finalizedState);
    // delete states before the finalized state
    const prunedStates = this.pruned.map(summary => summary.stateRoot);
    this.db.stateCache.batchDelete(prunedStates);
    this.logger.info(
      `Archiving of finalized states completed (finalized epoch #${epoch})`);
    this.logger.profile("Archive States");
  }
}
