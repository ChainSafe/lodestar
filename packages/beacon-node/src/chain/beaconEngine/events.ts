import {EventEmitter} from "node:events";
import {routes} from "@lodestar/api";
import {StrictEventEmitterSingleArg} from "../../util/strictEvents.js";
import {ChainViewUpdate} from "../chainView/interface.js";

export enum BeaconEngineEvent {
  executionPayloadImported = "executionPayloadImported",
  chainViewUpdated = "chainViewUpdated",
}

export type BeaconEngineEventData = {
  [BeaconEngineEvent.executionPayloadImported]: routes.events.EventData[routes.events.EventType.executionPayload];
  [BeaconEngineEvent.chainViewUpdated]: ChainViewUpdate;
};

export type IBeaconEngineEventBus = StrictEventEmitterSingleArg<BeaconEngineEventData>;
export class BeaconEngineEventBus extends (EventEmitter as {new (): IBeaconEngineEventBus}) {}
