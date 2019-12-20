/**
 * @module tasks used for running tasks on specific events
 */

import {IService} from "../node";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {IBeaconDb} from "../db/api";
import {IBeaconChain} from "../chain";
import {Checkpoint} from "@chainsafe/eth2.0-types";
import {ArchiveBlocksTask} from "./tasks/archiveBlocks";
import {ILogger} from "../logger";

export interface ITasksModules {
  db: IBeaconDb;
  logger: ILogger;
  chain: IBeaconChain;
}

/**
 * Used for running tasks that depends on some events or are executed
 * periodically.
 */
export class TasksService implements IService {

  private readonly config: IBeaconConfig;

  private readonly db: IBeaconDb;

  private readonly chain: IBeaconChain;

  private readonly logger: ILogger;

  public constructor(config: IBeaconConfig, modules: ITasksModules) {
    this.config = config;
    this.db = modules.db;
    this.chain = modules.chain;
    this.logger = modules.logger;
  }

  public async start(): Promise<void> {
    this.chain.on("finalizedCheckpoint", this.handleFinalizedCheckpointChores);
  }

  public async stop(): Promise<void> {
    this.chain.removeListener("finalizedCheckpoint", this.handleFinalizedCheckpointChores);
  }

  private handleFinalizedCheckpointChores = async (finalizedCheckpoint: Checkpoint): Promise<void> => {
    new ArchiveBlocksTask(this.config, {db: this.db, logger: this.logger}, finalizedCheckpoint).run();
  };

}