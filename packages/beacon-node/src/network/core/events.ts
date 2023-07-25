import EventEmitter from "node:events";
import {ResponseIncoming, ResponseOutgoing} from "@lodestar/reqresp";
import {AsyncIterableEventBus, IteratorEvent, RequestEvent} from "../../util/asyncIterableToEvents.js";
import {StrictEventEmitterSingleArg} from "../../util/strictEvents.js";
import {EventDirection} from "../../util/workerEvents.js";
import {IncomingRequestArgs, OutgoingRequestArgs} from "../reqresp/types.js";

export enum ReqRespBridgeEvent {
  outgoingRequest = "reqresp.outgoingRequest",
  outgoingResponse = "reqresp.outgoingResponse",
  incomingRequest = "reqresp.incomingRequest",
  incomingResponse = "reqresp.incomingResponse",
}

export type ReqRespBridgeEventData = {
  [ReqRespBridgeEvent.outgoingRequest]: RequestEvent<OutgoingRequestArgs>;
  [ReqRespBridgeEvent.outgoingResponse]: IteratorEvent<ResponseOutgoing>;
  [ReqRespBridgeEvent.incomingRequest]: RequestEvent<IncomingRequestArgs>;
  [ReqRespBridgeEvent.incomingResponse]: IteratorEvent<ResponseIncoming>;
};

type IReqRespBridgeEventBus = StrictEventEmitterSingleArg<ReqRespBridgeEventData>;

export class ReqRespBridgeEventBus extends (EventEmitter as {new (): IReqRespBridgeEventBus}) {}

// NOTE: If the same event is on this two arrays it can create an infinite cycle
export const reqRespBridgeEventDirection: Record<ReqRespBridgeEvent, EventDirection> = {
  [ReqRespBridgeEvent.outgoingRequest]: EventDirection.mainToWorker,
  [ReqRespBridgeEvent.outgoingResponse]: EventDirection.mainToWorker,
  [ReqRespBridgeEvent.incomingRequest]: EventDirection.workerToMain,
  [ReqRespBridgeEvent.incomingResponse]: EventDirection.workerToMain,
};

export function getReqRespBridgeReqEvents(
  events: IReqRespBridgeEventBus
): AsyncIterableEventBus<OutgoingRequestArgs, ResponseIncoming> {
  return {
    emitRequest: (data) => events.emit(ReqRespBridgeEvent.outgoingRequest, {...data, emittedAt: Date.now()}),
    emitResponse: (data) => events.emit(ReqRespBridgeEvent.incomingResponse, {...data, emittedAt: Date.now()}),
    onRequest: (cb) => events.on(ReqRespBridgeEvent.outgoingRequest, cb),
    onResponse: (cb) => events.on(ReqRespBridgeEvent.incomingResponse, cb),
  };
}

export function getReqRespBridgeRespEvents(
  events: IReqRespBridgeEventBus
): AsyncIterableEventBus<IncomingRequestArgs, ResponseOutgoing> {
  return {
    emitRequest: (data) => events.emit(ReqRespBridgeEvent.incomingRequest, {...data, emittedAt: Date.now()}),
    emitResponse: (data) => events.emit(ReqRespBridgeEvent.outgoingResponse, {...data, emittedAt: Date.now()}),
    onRequest: (cb) => events.on(ReqRespBridgeEvent.incomingRequest, cb),
    onResponse: (cb) => events.on(ReqRespBridgeEvent.outgoingResponse, cb),
  };
}

export enum NetworkWorkerThreadEventType {
  networkEvent = "networkEvent",
  reqRespBridgeEvents = "reqRespBridgeEvents",
}
