import {AbortSignal} from "abort-controller";
import {Root, phase0, Slot, allForks} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";
import {CheckpointStateCache, StateContextCache} from "../stateCache";
import {ChainEventEmitter} from "../emitter";
import {IMetrics} from "../../metrics";
import {IBeaconDb} from "../../db";
import {JobQueue} from "../../util/queue";
import {IStateRegenerator} from "./interface";
import {StateRegenerator} from "./regen";

const REGEN_QUEUE_MAX_LEN = 256;

type QueuedStateRegeneratorModules = {
  config: IBeaconConfig;
  emitter: ChainEventEmitter;
  forkChoice: IForkChoice;
  stateCache: StateContextCache;
  checkpointStateCache: CheckpointStateCache;
  db: IBeaconDb;
  metrics: IMetrics | null;
  signal: AbortSignal;
};

/**
 * Regenerates states that have already been processed by the fork choice
 *
 * All requests are queued so that only a single state at a time may be regenerated at a time
 */
export class QueuedStateRegenerator implements IStateRegenerator {
  private regen: StateRegenerator;
  private jobQueue: JobQueue;

  constructor(modules: QueuedStateRegeneratorModules) {
    this.regen = new StateRegenerator(modules);
    this.jobQueue = new JobQueue(
      {maxLength: REGEN_QUEUE_MAX_LEN, signal: modules.signal},
      modules.metrics ? modules.metrics.regenQueue : undefined
    );
  }

  async getPreState(block: allForks.BeaconBlock): Promise<CachedBeaconState<allForks.BeaconState>> {
    return await this.jobQueue.push(async () => await this.regen.getPreState(block));
  }

  async getCheckpointState(cp: phase0.Checkpoint): Promise<CachedBeaconState<allForks.BeaconState>> {
    return await this.jobQueue.push(async () => await this.regen.getCheckpointState(cp));
  }

  async getBlockSlotState(blockRoot: Root, slot: Slot): Promise<CachedBeaconState<allForks.BeaconState>> {
    return await this.jobQueue.push(async () => await this.regen.getBlockSlotState(blockRoot, slot));
  }

  async getState(stateRoot: Root): Promise<CachedBeaconState<allForks.BeaconState>> {
    return await this.jobQueue.push(async () => await this.regen.getState(stateRoot));
  }
}
