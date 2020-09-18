import pushable, {Pushable} from "it-pushable/index";
import {SlotProcessJob} from "./types";
import {ITreeStateContext} from "../../../../db/api/beacon/stateContextCache";
import {ModuleThread, spawn, Thread, Worker} from "threads";
import {Transfer} from "threads/worker";
import {LongStateTransitionWorker} from "./stateTransition";
import {ChainEventEmitter} from "../../../emitter";
import {Slot} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";

export class StateTransitionWorker {
  protected queue?: Pushable<SlotProcessJob>;
  protected resultGenerator?: AsyncGenerator<ITreeStateContext | Error>;
  protected workerThread?: ModuleThread<LongStateTransitionWorker>;

  public async start(): Promise<void> {
    this.queue = pushable<SlotProcessJob>();
    this.workerThread = await spawn<LongStateTransitionWorker>(new Worker("./stateTransition"));
    this.resultGenerator = this.resultGeneratorFunction(this.queue, this.workerThread);
  }

  public async stop(): Promise<void> {
    this.queue?.end();
    this.queue = undefined;
    if (this.workerThread) {
      await Thread.terminate(this.workerThread);
    }
  }

  public async processSlotsToNearestCheckpoint(
    config: IBeaconConfig,
    emitter: ChainEventEmitter,
    stateCtx: ITreeStateContext,
    slot: Slot
  ): Promise<ITreeStateContext> {
    this.queue?.push({config, preStateContext: stateCtx, targetSlot: slot, emitter});
    const result = (await this.resultGenerator?.next())?.value;
    if (result instanceof Error) {
      throw result;
    }
    return result;
  }

  public async processSlots(
    config: IBeaconConfig,
    stateCtx: ITreeStateContext,
    slot: Slot
  ): Promise<ITreeStateContext> {
    this.queue?.push({config, preStateContext: stateCtx, targetSlot: slot});
    const result = (await this.resultGenerator?.next())?.value;
    if (result instanceof Error) {
      throw result;
    }
    return result;
  }

  public isRunning(): boolean {
    return !!this.queue;
  }

  protected resultGeneratorFunction = async function* (
    queue: Pushable<SlotProcessJob>,
    workerThread: ModuleThread<LongStateTransitionWorker>
  ): AsyncGenerator<ITreeStateContext | Error> {
    for await (const job of queue) {
      try {
        if (job.emitter) {
          workerThread.checkpoints().subscribe((checkpoint) => {
            job.emitter?.emit("checkpoint", checkpoint);
          });
        }
        const result = await workerThread.longCheckpointedStateTransitionWorkerProcess(
          job.config.params,
          (Transfer(job.config.types.BeaconState.serialize(job.preStateContext.state)) as unknown) as ArrayBuffer,
          job.targetSlot,
          !!job.emitter
        );
        const state = job.config.types.BeaconState.tree.deserialize(new Uint8Array((result as unknown) as ArrayBuffer));
        const epochCtx = new EpochContext(job.config);
        epochCtx.loadState(state);
        yield {
          state,
          epochCtx,
        };
      } catch (e) {
        yield e;
      }
    }
  };
}

export const stateTransitionWorker = new StateTransitionWorker();
