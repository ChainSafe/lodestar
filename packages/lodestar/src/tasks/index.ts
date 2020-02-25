/**
 * @module tasks used for running tasks on specific events
 */

import {IService} from "../node";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconDb} from "../db/api";
import {IBeaconChain} from "../chain";
import {Checkpoint} from "@chainsafe/lodestar-types";
import {ArchiveBlocksTask} from "./tasks/archiveBlocks";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {Sync} from "../sync";
import {InteropSubnetsJoiningTask} from "./tasks/interopSubnetsJoiningTask";
import {INetwork} from "../network";

export interface ITasksModules {
  db: IBeaconDb;
  logger: ILogger;
  chain: IBeaconChain;
  sync: Sync;
  network: INetwork;
}

/**
 * Used for running tasks that depends on some events or are executed
 * periodically.
 */
export class TasksService implements IService {

  private readonly config: IBeaconConfig;
  private readonly db: IBeaconDb;
  private readonly chain: IBeaconChain;
  private readonly sync: Sync;
  private readonly network: INetwork;
  private readonly logger: ILogger;

  public constructor(config: IBeaconConfig, modules: ITasksModules) {
    this.config = config;
    this.db = modules.db;
    this.chain = modules.chain;
    this.logger = modules.logger;
    this.sync = modules.sync;
    this.network = modules.network;
  }

  public async start(): Promise<void> {
    this.chain.on("finalizedCheckpoint", this.handleFinalizedCheckpointChores);
    this.sync.on("regularSyncStarted", this.handleRegularSyncStartedTasks);
  }

  public async stop(): Promise<void> {
    this.chain.removeListener("finalizedCheckpoint", this.handleFinalizedCheckpointChores);
    this.sync.removeListener("regularSyncStarted", this.handleRegularSyncStartedTasks);
  }

  private handleFinalizedCheckpointChores = async (finalizedCheckpoint: Checkpoint): Promise<void> => {
    new ArchiveBlocksTask(this.config, {db: this.db, logger: this.logger}, finalizedCheckpoint).run();
  };
  
  private handleRegularSyncStartedTasks = async (): Promise<void> => {
    new InteropSubnetsJoiningTask(this.config, {network: this.network}).run();
  };

}