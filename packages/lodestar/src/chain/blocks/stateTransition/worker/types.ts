import {ITreeStateContext} from "../../../../db/api/beacon/stateContextCache";
import {Slot} from "@chainsafe/lodestar-types";
import {ChainEventEmitter} from "../../../emitter";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

export type SlotProcessJob = {
  config: IBeaconConfig,
  preStateContext: ITreeStateContext;
  targetSlot: Slot;
  emitter?: ChainEventEmitter;
};
