/**
 * @module tasks used for running tasks on specific events
 */

import {IService} from "../node";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconDb} from "../db/api";
import {IBeaconChain, BlockSummary} from "../chain";
import {ArchiveBlocksTask} from "./tasks/archiveBlocks";
import {ArchiveStatesTask} from "./tasks/archiveStates";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IBeaconSync} from "../sync";
import {InteropSubnetsJoiningTask} from "./tasks/interopSubnetsJoiningTask";
import {INetwork} from "../network";

export interface ITasksModules {
  db: IBeaconDb;
  logger: ILogger;
  chain: IBeaconChain;
  sync: IBeaconSync;
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
  private readonly sync: IBeaconSync;
  private readonly network: INetwork;
  private readonly logger: ILogger;

  private interopSubnetsTask: InteropSubnetsJoiningTask;

  public constructor(config: IBeaconConfig, modules: ITasksModules) {
    this.config = config;
    this.db = modules.db;
    this.chain = modules.chain;
    this.logger = modules.logger;
    this.sync = modules.sync;
    this.network = modules.network;
    this.interopSubnetsTask = new InteropSubnetsJoiningTask(this.config,
      {chain: this.chain, network: this.network, logger: this.logger});
  }

  public async start(): Promise<void> {
    this.chain.forkChoice.on("prune", this.handleFinalizedCheckpointChores);
    await this.interopSubnetsTask.start();
  }

  public async stop(): Promise<void> {
    this.chain.forkChoice.removeListener("prune", this.handleFinalizedCheckpointChores);
    await this.interopSubnetsTask.stop();
  }

  private handleFinalizedCheckpointChores = async (finalized: BlockSummary, pruned: BlockSummary[]): Promise<void> => {
    new ArchiveBlocksTask(this.config, {db: this.db, logger: this.logger}, finalized, pruned).run();
    new ArchiveStatesTask(this.config, {db: this.db, logger: this.logger}, finalized, pruned).run();
  };

}
