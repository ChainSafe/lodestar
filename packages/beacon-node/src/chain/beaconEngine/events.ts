import {EventEmitter} from "node:events";
import {StrictEventEmitterSingleArg} from "../../util/strictEvents.js";
import {ChainViewUpdate} from "../chainView/interface.js";

export enum BeaconEngineEvent {
  chainViewUpdated = "chainViewUpdated",
}

export type BeaconEngineEventData = {
  [BeaconEngineEvent.chainViewUpdated]: ChainViewUpdate;
};

export type IBeaconEngineEventBus = StrictEventEmitterSingleArg<BeaconEngineEventData>;
export class BeaconEngineEventBus extends (EventEmitter as {new (): IBeaconEngineEventBus}) {}
