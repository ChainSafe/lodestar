import {EventEmitter} from "node:events";
import {routes} from "@lodestar/api";
import {Slot} from "@lodestar/types";
import {StrictEventEmitterSingleArg} from "../../util/strictEvents.js";
import {ChainViewUpdate} from "../chainView/interface.js";

export enum BeaconEngineEvent {
  fatalError = "fatalError",
  executionPayloadImported = "executionPayloadImported",
  chainViewUpdated = "chainViewUpdated",
  earliestAvailableSlotUpdated = "earliestAvailableSlotUpdated",
}

export type BeaconEngineEventData = {
  [BeaconEngineEvent.earliestAvailableSlotUpdated]: Slot;
  [BeaconEngineEvent.fatalError]: Error;
  [BeaconEngineEvent.executionPayloadImported]: routes.events.EventData[routes.events.EventType.executionPayload];
  [BeaconEngineEvent.chainViewUpdated]: ChainViewUpdate;
};

export type IBeaconEngineEventBus = StrictEventEmitterSingleArg<BeaconEngineEventData>;
export class BeaconEngineEventBus extends (EventEmitter as {new (): IBeaconEngineEventBus}) {}
