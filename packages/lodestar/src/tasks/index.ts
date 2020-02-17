/**
 * @module tasks used for running tasks on specific events
 */

import {IService} from "../node";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {IBeaconDb} from "../db/api";
import {IBeaconChain} from "../chain";
import {Checkpoint, Epoch} from "@chainsafe/eth2.0-types";
import {ArchiveBlocksTask} from "./tasks/archiveBlocks";
import {ILogger} from  "@chainsafe/eth2.0-utils/lib/logger";
import FastPriorityQueue from "fastpriorityqueue";
import {IBlockProcessJob} from "../chain";
import {computeEpochAtSlot} from "@chainsafe/eth2.0-state-transition";

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
    this.chain.on("newEpoch", this.blockProcessingQueueCleanUp);
  }

  public async stop(): Promise<void> {
    this.chain.removeListener("finalizedCheckpoint", this.handleFinalizedCheckpointChores);
    this.chain.removeListener("newEpoch", this.blockProcessingQueueCleanUp);
  }

  private handleFinalizedCheckpointChores = async (finalizedCheckpoint: Checkpoint): Promise<void> => {
    new ArchiveBlocksTask(this.config, {db: this.db, logger: this.logger}, finalizedCheckpoint).run();
  };

  private blockProcessingQueueCleanUp = 
  async (newEpoch: Epoch, blockProcessingQueue: FastPriorityQueue<IBlockProcessJob>): Promise<void> => {
    return new Promise((resolve): void => {
      while (!blockProcessingQueue.isEmpty()) {
        const blockProcessJob = blockProcessingQueue.poll();
        if(computeEpochAtSlot(this.config, blockProcessJob.signedBlock.message.slot) < newEpoch){
          // orphan block
        }
      }
      if(blockProcessingQueue.isEmpty()) {
        resolve();
      }
    });
  };
}