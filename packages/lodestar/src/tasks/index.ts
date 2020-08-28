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
import {DiversifyPeersBySubnetTask} from "./tasks/diversifyPeersBySubnetTask";
import {IReputationStore} from "../sync/IReputation";
import {CheckPeerAliveTask} from "./tasks/checkPeerAliveTask";

export interface ITasksModules {
  db: IBeaconDb;
  logger: ILogger;
  chain: IBeaconChain;
  sync: IBeaconSync;
  network: INetwork;
  reps: IReputationStore;
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
  private readonly reps: IReputationStore;

  private interopSubnetsTask: InteropSubnetsJoiningTask;
  private diversifyPeersTask: DiversifyPeersBySubnetTask;
  private checkPeerAliveTask: CheckPeerAliveTask;

  public constructor(config: IBeaconConfig, modules: ITasksModules) {
    this.config = config;
    this.db = modules.db;
    this.chain = modules.chain;
    this.logger = modules.logger;
    this.sync = modules.sync;
    this.network = modules.network;
    this.reps = modules.reps;
    this.interopSubnetsTask = new InteropSubnetsJoiningTask(this.config, {
      chain: this.chain,
      network: this.network,
      logger: this.logger,
    });
    this.diversifyPeersTask = new DiversifyPeersBySubnetTask(this.config, {
      network: this.network,
      reps: this.reps,
      logger: this.logger,
    });
    this.checkPeerAliveTask = new CheckPeerAliveTask(this.config, {
      network: this.network,
      reps: this.reps,
      logger: this.logger,
    });
  }

  public async start(): Promise<void> {
    this.chain.forkChoice.on("prune", this.handleFinalizedCheckpointChores);
    this.network.gossip.on("gossip:start", this.handleGossipStart);
    this.network.gossip.on("gossip:stop", this.handleGossipStop);
    this.sync.on("syncCompleted", this.handleSyncCompleted);
  }

  public async stop(): Promise<void> {
    this.chain.forkChoice.removeListener("prune", this.handleFinalizedCheckpointChores);
    this.network.gossip.removeListener("gossip:start", this.handleGossipStart);
    this.network.gossip.removeListener("gossip:stop", this.handleGossipStop);
    await Promise.all([this.interopSubnetsTask.stop(), this.diversifyPeersTask.stop(), this.checkPeerAliveTask.stop()]);
  }

  private handleGossipStart = async (): Promise<void> => {
    await this.interopSubnetsTask.start();
  };

  private handleGossipStop = async (): Promise<void> => {
    await this.interopSubnetsTask.stop();
  };

  private handleSyncCompleted = async (): Promise<void> => {
    await Promise.all([this.diversifyPeersTask.start(), this.checkPeerAliveTask.start()]);
  };

  private handleFinalizedCheckpointChores = async (finalized: BlockSummary, pruned: BlockSummary[]): Promise<void> => {
    await new ArchiveBlocksTask(this.config, {db: this.db, logger: this.logger}, finalized, pruned).run();
    await new ArchiveStatesTask(this.config, {db: this.db, logger: this.logger}, finalized, pruned).run();
  };
}
