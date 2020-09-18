import {expose, Transfer} from "threads/worker";
import {TransferDescriptor} from "threads/dist";
import {IBeaconParams} from "@chainsafe/lodestar-params";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {Checkpoint, Slot} from "@chainsafe/lodestar-types";
import {processSlotsToNearestCheckpoint} from "../stateTransition";
import {Observable, Subject} from "threads/observable";
import {ChainEventEmitter} from "../../../emitter";
import {EventEmitter} from "events";
import {ITreeStateContext} from "../../../../db/api/beacon/stateContextCache";
import {processSlots} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/slot";

const checkpointSubject = new Subject<Checkpoint>();

const worker = {
  longCheckpointedStateTransitionWorkerProcess: async function (
    params: IBeaconParams,
    serializedState: ArrayBuffer,
    slot: Slot,
    emitCheckpoints = false
  ): Promise<TransferDescriptor<ArrayBuffer>> {
    const config = createIBeaconConfig(params);
    const state = config.types.BeaconState.tree.deserialize(new Uint8Array(serializedState));
    const epochCtx = new EpochContext(config);
    epochCtx.loadState(state);
    let newStateContext: ITreeStateContext;
    if (emitCheckpoints) {
      const emitter: ChainEventEmitter = new EventEmitter();
      emitter.on("checkpoint", (c) => {
        checkpointSubject.next(c);
      });
      newStateContext = await processSlotsToNearestCheckpoint(emitter, {state, epochCtx}, slot);
    } else {
      processSlots(epochCtx, state, slot);
      newStateContext = {
        state,
        epochCtx,
      };
    }
    return Transfer(config.types.BeaconState.serialize(newStateContext.state));
  },
  checkpoints: function () {
    return Observable.from(checkpointSubject);
  },
};

expose(worker);

export type LongStateTransitionWorker = typeof worker;
