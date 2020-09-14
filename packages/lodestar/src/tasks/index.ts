/**
 * @module tasks used for running tasks on specific events
 */

import {Checkpoint} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
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
    this.chain.emitter.on("forkChoice:finalized", this.onFinalizedCheckpoint);
    this.chain.emitter.on("checkpoint", this.onCheckpoint);
    this.network.gossip.on("gossip:start", this.handleGossipStart);
    this.network.gossip.on("gossip:stop", this.handleGossipStop);
  }

  public async stop(): Promise<void> {
    this.chain.emitter.removeListener("forkChoice:finalized", this.onFinalizedCheckpoint);
    this.chain.emitter.removeListener("checkpoint", this.onCheckpoint);
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

  private onFinalizedCheckpoint = async (finalized: Checkpoint): Promise<void> => {
    await new ArchiveStatesTask(this.config, {db: this.db, logger: this.logger}, finalized).run();
    await Promise.all([
      new ArchiveBlocksTask(
        this.config,
        {db: this.db, forkChoice: this.chain.forkChoice, logger: this.logger},
        finalized
      ).run(),
      this.db.checkpointStateCache.pruneFinalized(finalized.epoch),
    ]);
    // tasks rely on extended fork choice
    this.chain.forkChoice.prune();
  };

  private onCheckpoint = async (): Promise<void> => {
    await Promise.all([
      this.db.checkpointStateCache.prune(
        this.chain.forkChoice.getFinalizedCheckpoint().epoch,
        this.chain.forkChoice.getJustifiedCheckpoint().epoch
      ),
      this.db.stateCache.prune(),
    ]);
  };
}
