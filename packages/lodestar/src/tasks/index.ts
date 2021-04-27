/**
 * @module tasks used for running tasks on specific events
 */

import {phase0} from "@chainsafe/lodestar-types";
import {AbortSignal} from "abort-controller";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";

import {IBeaconDb} from "../db";
import {ChainEvent, IBeaconChain} from "../chain";
import {ArchiveBlocksTask} from "./tasks/archiveBlocks";
import {StatesArchiver} from "./tasks/archiveStates";
import {IBeaconSync} from "../sync";
import {INetwork} from "../network";
import {JobQueue} from "../util/queue";

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
export class TasksService {
  private readonly config: IBeaconConfig;
  private readonly db: IBeaconDb;
  private readonly chain: IBeaconChain;
  private readonly network: INetwork;
  private readonly logger: ILogger;
  private jobQueue: JobQueue;

  private readonly statesArchiver: StatesArchiver;

  constructor({
    config,
    signal,
    maxLength = 256,
    ...modules
  }: ITasksModules & {
    config: IBeaconConfig;
    signal: AbortSignal;
    maxLength?: number;
  }) {
    this.config = config;
    this.db = modules.db;
    this.chain = modules.chain;
    this.logger = modules.logger;
    this.network = modules.network;
    this.statesArchiver = new StatesArchiver(this.config, modules);
    this.jobQueue = new JobQueue({maxLength, signal});
  }

  start(): void {
    this.chain.emitter.on(ChainEvent.forkChoiceFinalized, this.onFinalizedCheckpoint);
    this.chain.emitter.on(ChainEvent.checkpoint, this.onCheckpoint);
  }

  async stop(): Promise<void> {
    this.chain.emitter.off(ChainEvent.forkChoiceFinalized, this.onFinalizedCheckpoint);
    this.chain.emitter.off(ChainEvent.checkpoint, this.onCheckpoint);
    // Archive latest finalized state
    await this.statesArchiver.archiveState(this.chain.getFinalizedCheckpoint());
  }

  private onFinalizedCheckpoint = async (finalized: phase0.Checkpoint): Promise<void> => {
    return this.jobQueue.push(async () => await this.processFinalizedCheckpoint(finalized));
  };

  private processFinalizedCheckpoint = async (finalized: phase0.Checkpoint): Promise<void> => {
    try {
      await new ArchiveBlocksTask(
        this.config,
        {db: this.db, forkChoice: this.chain.forkChoice, logger: this.logger},
        finalized
      ).run();

      // should be after ArchiveBlocksTask to handle restart cleanly
      await this.statesArchiver.maybeArchiveState(finalized);

      const finalizedEpoch = finalized.epoch;
      await Promise.all([
        this.chain.checkpointStateCache.pruneFinalized(finalizedEpoch),
        this.chain.stateCache.deleteAllBeforeEpoch(finalizedEpoch),
        this.db.attestation.pruneFinalized(finalizedEpoch),
        this.db.aggregateAndProof.pruneFinalized(finalizedEpoch),
        this.db.syncCommitteeSignature.pruneFinalized(finalizedEpoch),
        this.db.contributionAndProof.pruneFinalized(finalizedEpoch),
      ]);

      // tasks rely on extended fork choice
      this.chain.forkChoice.prune(finalized.root);
      this.logger.verbose("Finish processing finalized checkpoint", {epoch: finalizedEpoch});
    } catch (e) {
      this.logger.error("Error processing finalized checkpoint", {epoch: finalized.epoch}, e);
    }
  };

  private onCheckpoint = async (): Promise<void> => {
    const headStateRoot = this.chain.forkChoice.getHead().stateRoot;
    await Promise.all([
      this.chain.checkpointStateCache.prune(
        this.chain.forkChoice.getFinalizedCheckpoint().epoch,
        this.chain.forkChoice.getJustifiedCheckpoint().epoch
      ),
      this.chain.stateCache.prune(headStateRoot),
    ]);
  };
}
