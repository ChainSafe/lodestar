/**
 * @module tasks used for running tasks on specific events
 */

import {IService} from "../node";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconDb} from "../db/api";
import {IBeaconChain} from "../chain";
import {Checkpoint} from "@chainsafe/lodestar-types";
import {ArchiveBlocksTask} from "./tasks/archiveBlocks";
import {ArchiveStatesTask} from "./tasks/archiveStates";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IBeaconSync} from "../sync";
import {InteropSubnetsJoiningTask} from "./tasks/interopSubnetsJoiningTask";
import {INetwork} from "../network";
import {WatchEth1ForProposingTask} from "./tasks/watchEth1ForProposingTask";
import {IEth1Notifier} from "../eth1";

export interface ITasksModules {
  db: IBeaconDb;
  logger: ILogger;
  chain: IBeaconChain;
  sync: IBeaconSync;
  network: INetwork;
  eth1: IEth1Notifier;
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
  private readonly eth1: IEth1Notifier;

  private interopSubnetsTask: InteropSubnetsJoiningTask;
  private watchEth1Task: WatchEth1ForProposingTask;

  public constructor(config: IBeaconConfig, modules: ITasksModules) {
    this.config = config;
    this.db = modules.db;
    this.chain = modules.chain;
    this.logger = modules.logger;
    this.sync = modules.sync;
    this.network = modules.network;
    this.eth1 = modules.eth1;
    this.interopSubnetsTask = new InteropSubnetsJoiningTask(this.config,
      {chain: this.chain, network: this.network, logger: this.logger});
    this.watchEth1Task = new WatchEth1ForProposingTask(this.config, {
      db: this.db, eth1: this.eth1, logger: this.logger, sync: this.sync
    });
  }

  public async start(): Promise<void> {
    this.chain.on("finalizedCheckpoint", this.handleFinalizedCheckpointChores);
    await this.interopSubnetsTask.start();
    await this.watchEth1Task.start();
  }

  public async stop(): Promise<void> {
    this.chain.removeListener("finalizedCheckpoint", this.handleFinalizedCheckpointChores);
    await this.interopSubnetsTask.stop();
    await this.watchEth1Task.stop();
  }

  private handleFinalizedCheckpointChores = async (finalizedCheckpoint: Checkpoint): Promise<void> => {
    new ArchiveBlocksTask(this.config, {db: this.db, logger: this.logger}, finalizedCheckpoint).run();
    new ArchiveStatesTask(this.config, {db: this.db, logger: this.logger}, finalizedCheckpoint).run().then(() => {
      this.watchEth1Task.newFinalizedCheckpoint();
    });
  };

}
