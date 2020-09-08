/**
 * @module tasks used for running tasks on specific events
 */

import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBlockSummary} from "@chainsafe/lodestar-fork-choice";
import {ILogger} from "@chainsafe/lodestar-utils";

import {IService} from "../node";
import {IBeaconDb} from "../db/api";
import {IBeaconChain} from "../chain";
import {ArchiveBlocksTask} from "./tasks/archiveBlocks";
import {ArchiveStatesTask} from "./tasks/archiveStates";
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
    this.interopSubnetsTask = new InteropSubnetsJoiningTask(this.config, {
      chain: this.chain,
      network: this.network,
      logger: this.logger,
    });
  }

  public async start(): Promise<void> {
    this.chain.emitter.on("forkChoice:prune", this.handleFinalizedCheckpointChores);
    this.network.gossip.on("gossip:start", this.handleGossipStart);
    this.network.gossip.on("gossip:stop", this.handleGossipStop);
  }

  public async stop(): Promise<void> {
    this.chain.emitter.removeListener("forkChoice:prune", this.handleFinalizedCheckpointChores);
    this.network.gossip.removeListener("gossip:start", this.handleGossipStart);
    this.network.gossip.removeListener("gossip:stop", this.handleGossipStop);
    await this.interopSubnetsTask.stop();
  }

  private handleGossipStart = async (): Promise<void> => {
    await this.interopSubnetsTask.start();
  };

  private handleGossipStop = async (): Promise<void> => {
    await this.interopSubnetsTask.stop();
  };

  private handleFinalizedCheckpointChores = async (
    finalized: IBlockSummary,
    pruned: IBlockSummary[]
  ): Promise<void> => {
    await new ArchiveBlocksTask(this.config, {db: this.db, logger: this.logger}, finalized, pruned).run();
    await new ArchiveStatesTask(this.config, {db: this.db, logger: this.logger}, finalized, pruned).run();
  };
}
