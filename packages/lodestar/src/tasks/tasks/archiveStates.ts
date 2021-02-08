/**
 * @module tasks
 */

import {ITask} from "../interface";
import {IBeaconDb} from "../../db/api";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {BeaconState, Checkpoint} from "@chainsafe/lodestar-types";
import {TreeBacked} from "@chainsafe/ssz";
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

  private finalized: Checkpoint;

  public constructor(config: IBeaconConfig, modules: IArchiveStatesModules, finalized: Checkpoint) {
    this.chain = modules.chain;
    this.db = modules.db;
    this.logger = modules.logger;
    this.config = config;
    this.finalized = finalized;
  }

  public async run(): Promise<void> {
    this.logger.info("Archive states started", {finalizedEpoch: this.finalized.epoch});
    this.logger.profile("Archive States epoch #" + this.finalized.epoch);
    // store the state of finalized checkpoint
    const stateCache = this.chain.checkpointStateCache.get(this.finalized);
    if (!stateCache) {
      throw Error("No state in cache for finalized checkpoint state epoch #" + this.finalized.epoch);
    }
    const finalizedState = stateCache.state;
    await this.db.stateArchive.put(finalizedState.slot, finalizedState.getOriginalState() as TreeBacked<BeaconState>);
    // don't delete states before the finalized state, auto-prune will take care of it
    this.logger.info("Archive states completed", {finalizedEpoch: this.finalized.epoch});
    this.logger.profile("Archive States epoch #" + this.finalized.epoch);
  }
}
