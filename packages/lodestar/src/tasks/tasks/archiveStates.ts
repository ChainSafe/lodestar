/**
 * @module tasks
 */

import {ITask} from "../interface";
import {IBeaconDb} from "../../db/api";
import {toHexString} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IBlockSummary} from "@chainsafe/lodestar-fork-choice";
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

  private finalized: IBlockSummary;
  private pruned: IBlockSummary[];

  public constructor(
    config: IBeaconConfig,
    modules: IArchiveStatesModules,
    finalized: IBlockSummary,
    pruned: IBlockSummary[]
  ) {
    this.db = modules.db;
    this.logger = modules.logger;
    this.config = config;
    this.finalized = finalized;
    this.pruned = pruned;
  }

  public async run(): Promise<void> {
    const epoch = computeEpochAtSlot(this.config, this.finalized.slot);
    this.logger.info(`Started archiving states (finalized epoch #${epoch})...`);
    this.logger.profile("Archive States");
    // store the state of finalized checkpoint
    const stateCache = await this.db.stateCache.get(this.finalized.stateRoot);
    if (!stateCache) {
      throw Error(`No state cache in db for finalized stateRoot ${toHexString(this.finalized.stateRoot)}`);
    }
    const finalizedState = stateCache.state;
    await this.db.stateArchive.add(finalizedState);
    // delete states before the finalized state
    const prunedStates = this.pruned.map((summary) => summary.stateRoot);
    await this.db.stateCache.batchDelete(prunedStates);
    this.logger.info(`Archiving of finalized states completed (finalized epoch #${epoch})`);
    this.logger.profile("Archive States");
  }
}
