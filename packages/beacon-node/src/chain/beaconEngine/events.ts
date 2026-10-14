import {EventEmitter} from "node:events";
import {routes} from "@lodestar/api";
import {PayloadStatus} from "@lodestar/fork-choice";
import {RootHex, Slot} from "@lodestar/types";
import {StrictEventEmitterSingleArg} from "../../util/strictEvents.js";
import {ChainViewUpdate} from "../chainView/interface.js";

export enum BeaconEngineEvent {
  fatalError = "fatalError",
  executionPayloadImported = "executionPayloadImported",
  chainViewUpdated = "chainViewUpdated",
  earliestAvailableSlotUpdated = "earliestAvailableSlotUpdated",
  headUpdated = "headUpdated",
}

export type HeadUpdate = {
  slot: Slot;
  blockRoot: RootHex;
  stateRoot: RootHex;
  payloadStatus: PayloadStatus;
  headRootChanged: boolean;
  epochTransition: boolean;
  previousDutyDependentRoot: RootHex;
  currentDutyDependentRoot: RootHex;
  executionOptimistic: boolean;
};

export type BeaconEngineEventData = {
  [BeaconEngineEvent.headUpdated]: HeadUpdate;
  [BeaconEngineEvent.earliestAvailableSlotUpdated]: Slot;
  [BeaconEngineEvent.fatalError]: Error;
  [BeaconEngineEvent.executionPayloadImported]: routes.events.EventData[routes.events.EventType.executionPayload];
  [BeaconEngineEvent.chainViewUpdated]: ChainViewUpdate;
};

export type IBeaconEngineEventBus = StrictEventEmitterSingleArg<BeaconEngineEventData>;
export class BeaconEngineEventBus extends (EventEmitter as {new (): IBeaconEngineEventBus}) {}
