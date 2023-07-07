import EventEmitter from "node:events";
import StrictEventEmitter from "strict-event-emitter-types";
import {ExecutionEngineState} from "./interface.js";

export const enum ExecutionEngineEvent {
  stateChange = "stateChange",
}

export type ExecutionEngineEvents = {
  [ExecutionEngineEvent.stateChange]: (oldState: ExecutionEngineState, newState: ExecutionEngineState) => void;
};

export class ExecutionEngineEventEmitter extends (EventEmitter as {
  new (): StrictEventEmitter<EventEmitter, ExecutionEngineEvents>;
}) {}
