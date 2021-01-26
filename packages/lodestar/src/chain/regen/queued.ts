import {AbortSignal} from "abort-controller";
import {BeaconBlock, Root, Checkpoint, Slot} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";

import {ChainEventEmitter} from "../emitter";
import {IBeaconDb} from "../../db";
import {JobQueue} from "../../util/queue";
import {IStateRegenerator} from "./interface";
import {StateRegenerator} from "./regen";
import {CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util";

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
    db,
    signal,
    queueSize = 256,
  }: {
    config: IBeaconConfig;
    emitter: ChainEventEmitter;
    forkChoice: IForkChoice;
    db: IBeaconDb;
    signal: AbortSignal;
    queueSize?: number;
  }) {
    this.regen = new StateRegenerator({config, emitter, forkChoice, db});
    this.jobQueue = new JobQueue({queueSize, signal});
  }

  async getPreState(block: BeaconBlock): Promise<CachedBeaconState> {
    return await this.jobQueue.enqueueJob(async () => await this.regen.getPreState(block));
  }

  async getCheckpointState(cp: Checkpoint): Promise<CachedBeaconState> {
    return await this.jobQueue.enqueueJob(async () => await this.regen.getCheckpointState(cp));
  }

  async getBlockSlotState(blockRoot: Root, slot: Slot): Promise<CachedBeaconState> {
    return await this.jobQueue.enqueueJob(async () => await this.regen.getBlockSlotState(blockRoot, slot));
  }

  async getState(stateRoot: Root): Promise<CachedBeaconState> {
    return await this.jobQueue.enqueueJob(async () => await this.regen.getState(stateRoot));
  }
}
