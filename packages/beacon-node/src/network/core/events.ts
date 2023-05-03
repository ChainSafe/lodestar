import EventEmitter from "node:events";
import StrictEventEmitter from "strict-event-emitter-types";
import {ResponseIncoming, ResponseOutgoing} from "@lodestar/reqresp";
import {AsyncIterableEventBus, IteratorEvent, RequestEvent} from "../../util/asyncIterableToEvents.js";
import {IncomingRequestArgs, OutgoingRequestArgs} from "../reqresp/types.js";

export enum ReqRespBridgeEvent {
  outgoingRequest = "reqresp.outgoingRequest",
  outgoingResponse = "reqresp.outgoingResponse",
  incomingRequest = "reqresp.incomingRequest",
  incomingResponse = "reqresp.incomingResponse",
}

type ReqRespBridgeEvents = {
  [ReqRespBridgeEvent.outgoingRequest]: (data: RequestEvent<OutgoingRequestArgs>) => void;
  [ReqRespBridgeEvent.outgoingResponse]: (data: IteratorEvent<ResponseOutgoing>) => void;
  [ReqRespBridgeEvent.incomingRequest]: (data: RequestEvent<IncomingRequestArgs>) => void;
  [ReqRespBridgeEvent.incomingResponse]: (data: IteratorEvent<ResponseIncoming>) => void;
};

type IReqRespBridgeEventBus = StrictEventEmitter<EventEmitter, ReqRespBridgeEvents>;

export class ReqRespBridgeEventBus extends (EventEmitter as {new (): IReqRespBridgeEventBus}) {}

export function getReqRespBridgeReqEvents(
  events: IReqRespBridgeEventBus
): AsyncIterableEventBus<OutgoingRequestArgs, ResponseIncoming> {
  return {
    emitRequest: (data) => events.emit(ReqRespBridgeEvent.outgoingRequest, data),
    emitResponse: (data) => events.emit(ReqRespBridgeEvent.incomingResponse, data),
    onRequest: (cb) => events.on(ReqRespBridgeEvent.outgoingRequest, cb),
    onResponse: (cb) => events.on(ReqRespBridgeEvent.incomingResponse, cb),
  };
}

export function getReqRespBridgeRespEvents(
  events: IReqRespBridgeEventBus
): AsyncIterableEventBus<IncomingRequestArgs, ResponseOutgoing> {
  return {
    emitRequest: (data) => events.emit(ReqRespBridgeEvent.incomingRequest, data),
    emitResponse: (data) => events.emit(ReqRespBridgeEvent.outgoingResponse, data),
    onRequest: (cb) => events.on(ReqRespBridgeEvent.incomingRequest, cb),
    onResponse: (cb) => events.on(ReqRespBridgeEvent.outgoingResponse, cb),
  };
}
