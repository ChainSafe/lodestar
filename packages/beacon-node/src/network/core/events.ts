import EventEmitter from "node:events";
import {ResponseIncoming, ResponseOutgoing} from "@lodestar/reqresp";
import {
  AsyncIterableEventBus,
  IteratorEvent,
  RequestCancelEvent,
  RequestEvent,
} from "../../util/asyncIterableToEvents.js";
import {StrictEventEmitterSingleArg} from "../../util/strictEvents.js";
import {EventDirection} from "../events.js";
import {IncomingRequestArgs, OutgoingRequestArgs} from "../reqresp/types.js";

export enum ReqRespBridgeEvent {
  outgoingRequest = "reqresp.outgoingRequest",
  outgoingRequestCancel = "reqresp.outgoingRequestCancel",
  outgoingResponse = "reqresp.outgoingResponse",
  incomingRequest = "reqresp.incomingRequest",
  incomingRequestCancel = "reqresp.incomingRequestCancel",
  incomingResponse = "reqresp.incomingResponse",
}

export type ReqRespBridgeEventData = {
  [ReqRespBridgeEvent.outgoingRequest]: RequestEvent<OutgoingRequestArgs>;
  [ReqRespBridgeEvent.outgoingRequestCancel]: RequestCancelEvent;
  [ReqRespBridgeEvent.outgoingResponse]: IteratorEvent<ResponseOutgoing>;
  [ReqRespBridgeEvent.incomingRequest]: RequestEvent<IncomingRequestArgs>;
  [ReqRespBridgeEvent.incomingRequestCancel]: RequestCancelEvent;
  [ReqRespBridgeEvent.incomingResponse]: IteratorEvent<ResponseIncoming>;
};

type IReqRespBridgeEventBus = StrictEventEmitterSingleArg<ReqRespBridgeEventData>;

export class ReqRespBridgeEventBus extends (EventEmitter as {new (): IReqRespBridgeEventBus}) {}

// NOTE: If the same event is on this two arrays it can create an infinite cycle
export const reqRespBridgeEventDirection: Record<ReqRespBridgeEvent, EventDirection> = {
  [ReqRespBridgeEvent.outgoingRequest]: EventDirection.mainToWorker,
  [ReqRespBridgeEvent.outgoingRequestCancel]: EventDirection.mainToWorker,
  [ReqRespBridgeEvent.outgoingResponse]: EventDirection.mainToWorker,
  [ReqRespBridgeEvent.incomingRequest]: EventDirection.workerToMain,
  [ReqRespBridgeEvent.incomingRequestCancel]: EventDirection.workerToMain,
  [ReqRespBridgeEvent.incomingResponse]: EventDirection.workerToMain,
};

export function getReqRespBridgeReqEvents(
  events: IReqRespBridgeEventBus
): AsyncIterableEventBus<OutgoingRequestArgs, ResponseIncoming> {
  return {
    emitRequest: (data) => events.emit(ReqRespBridgeEvent.outgoingRequest, data),
    emitRequestCancel: (data) => events.emit(ReqRespBridgeEvent.outgoingRequestCancel, data),
    emitResponse: (data) => events.emit(ReqRespBridgeEvent.incomingResponse, data),
    onRequest: (cb) => events.on(ReqRespBridgeEvent.outgoingRequest, cb),
    onRequestCancel: (cb) => events.on(ReqRespBridgeEvent.outgoingRequestCancel, cb),
    onResponse: (cb) => events.on(ReqRespBridgeEvent.incomingResponse, cb),
  };
}

export function getReqRespBridgeRespEvents(
  events: IReqRespBridgeEventBus
): AsyncIterableEventBus<IncomingRequestArgs, ResponseOutgoing> {
  return {
    emitRequest: (data) => events.emit(ReqRespBridgeEvent.incomingRequest, data),
    emitRequestCancel: (data) => events.emit(ReqRespBridgeEvent.incomingRequestCancel, data),
    emitResponse: (data) => events.emit(ReqRespBridgeEvent.outgoingResponse, data),
    onRequest: (cb) => events.on(ReqRespBridgeEvent.incomingRequest, cb),
    onRequestCancel: (cb) => events.on(ReqRespBridgeEvent.incomingRequestCancel, cb),
    onResponse: (cb) => events.on(ReqRespBridgeEvent.outgoingResponse, cb),
  };
}

export enum NetworkWorkerThreadEventType {
  networkEvent = "networkEvent",
  reqRespBridgeEvents = "reqRespBridgeEvents",
}
