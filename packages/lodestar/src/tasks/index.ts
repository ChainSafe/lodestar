/**
 * @module tasks used for running tasks on specific events
 */

import {Checkpoint} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";

import {IService} from "../node";
import {IBeaconDb} from "../db/api";
import {ChainEvent, IBeaconChain} from "../chain";
import {ArchiveBlocksTask} from "./tasks/archiveBlocks";
import {ArchiveStatesTask} from "./tasks/archiveStates";
import {IBeaconSync} from "../sync";
import {InteropSubnetsJoiningTask} from "./tasks/interopSubnetsJoiningTask";
import {INetwork, NetworkEvent} from "../network";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";

/**
 * Minimum number of epochs between archived states
 */
export const MIN_EPOCHS_PER_DB_STATE = 1024;

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
    this.chain.emitter.on(ChainEvent.forkChoiceFinalized, this.onFinalizedCheckpoint);
    this.chain.emitter.on(ChainEvent.checkpoint, this.onCheckpoint);
    this.network.gossip.on(NetworkEvent.gossipStart, this.handleGossipStart);
    this.network.gossip.on(NetworkEvent.gossipStop, this.handleGossipStop);
  }

  public async stop(): Promise<void> {
    this.chain.emitter.off(ChainEvent.forkChoiceFinalized, this.onFinalizedCheckpoint);
    this.chain.emitter.off(ChainEvent.checkpoint, this.onCheckpoint);
    this.network.gossip.off(NetworkEvent.gossipStart, this.handleGossipStart);
    this.network.gossip.off(NetworkEvent.gossipStop, this.handleGossipStop);
    await this.interopSubnetsTask.stop();
    // Archive latest finalized state
    await new ArchiveStatesTask(
      this.config,
      {db: this.db, logger: this.logger},
      await this.chain.getFinalizedCheckpoint()
    ).run();
  }

  private handleGossipStart = async (): Promise<void> => {
    await this.interopSubnetsTask.start();
  };

  private handleGossipStop = async (): Promise<void> => {
    await this.interopSubnetsTask.stop();
  };

  private onFinalizedCheckpoint = async (finalized: Checkpoint): Promise<void> => {
    try {
      await new ArchiveBlocksTask(
        this.config,
        {db: this.db, forkChoice: this.chain.forkChoice, logger: this.logger},
        finalized
      ).run();
      // should be after ArchiveBlocksTask to handle restart cleanly
      const lastStoredSlot = (await this.db.stateArchive.lastKey()) as number;
      const lastStoredEpoch = computeEpochAtSlot(this.config, lastStoredSlot);
      if (finalized.epoch - lastStoredEpoch > MIN_EPOCHS_PER_DB_STATE) {
        await new ArchiveStatesTask(this.config, {db: this.db, logger: this.logger}, finalized).run();
      }
      await Promise.all([
        this.db.checkpointStateCache.pruneFinalized(finalized.epoch),
        this.db.attestation.pruneFinalized(finalized.epoch),
        this.db.aggregateAndProof.pruneFinalized(finalized.epoch),
      ]);
      // tasks rely on extended fork choice
      this.chain.forkChoice.prune(finalized.root);
      this.logger.verbose("Finish processing finalized checkpoint", {epoch: finalized.epoch});
    } catch (e) {
      this.logger.error("Error processing finalized checkpoint", {epoch: finalized.epoch}, e);
    }
  };

  private onCheckpoint = async (): Promise<void> => {
    const headStateRoot = this.chain.forkChoice.getHead().stateRoot;
    await Promise.all([
      this.db.checkpointStateCache.prune(
        this.chain.forkChoice.getFinalizedCheckpoint().epoch,
        this.chain.forkChoice.getJustifiedCheckpoint().epoch
      ),
      this.db.stateCache.prune(headStateRoot),
    ]);
  };
}
