import {AbortSignal} from "abort-controller";
import {BeaconBlock, Root, Checkpoint, Slot} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";

import {ITreeStateContext} from "../interface";
import {CheckpointStateCache, StateContextCache} from "../stateCache";
import {ChainEventEmitter} from "../emitter";
import {IBeaconDb} from "../../db";
import {JobQueue} from "../../util/queue";
import {IStateRegenerator} from "./interface";
import {StateRegenerator} from "./regen";

/**
 * Regenerates states that have already been processed by the fork choice
 *
 * All requests are queued so that only a single state at a time may be regenerated at a time
 */
export class QueuedStateRegenerator implements IStateRegenerator {
  private regen: StateRegenerator;
  private jobQueue: JobQueue;

  constructor({
    config,
    emitter,
    forkChoice,
    stateCache,
    checkpointStateCache,
    db,
    signal,
    queueSize = 256,
  }: {
    config: IBeaconConfig;
    emitter: ChainEventEmitter;
    forkChoice: IForkChoice;
    stateCache: StateContextCache;
    checkpointStateCache: CheckpointStateCache;
    db: IBeaconDb;
    signal: AbortSignal;
    queueSize?: number;
  }) {
    this.regen = new StateRegenerator({config, emitter, forkChoice, stateCache, checkpointStateCache, db});
    this.jobQueue = new JobQueue({queueSize, signal});
  }

  async getPreState(block: BeaconBlock): Promise<ITreeStateContext> {
    return await this.jobQueue.enqueueJob(async () => await this.regen.getPreState(block));
  }

  async getCheckpointState(cp: Checkpoint): Promise<ITreeStateContext> {
    return await this.jobQueue.enqueueJob(async () => await this.regen.getCheckpointState(cp));
  }

  async getBlockSlotState(blockRoot: Root, slot: Slot): Promise<ITreeStateContext> {
    return await this.jobQueue.enqueueJob(async () => await this.regen.getBlockSlotState(blockRoot, slot));
  }

  async getState(stateRoot: Root): Promise<ITreeStateContext> {
    return await this.jobQueue.enqueueJob(async () => await this.regen.getState(stateRoot));
  }
}
