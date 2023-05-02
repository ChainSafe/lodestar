import {ResponseIncoming, ResponseOutgoing} from "@lodestar/reqresp";
import {AsyncIterableEventBus} from "../../util/asyncIterableToEvents.js";
import {IncomingRequestArgs, OutgoingRequestArgs} from "../reqresp/types.js";
import {INetworkEventBus, NetworkEvent} from "../events.js";

export function getReqRespBridgeReqEvents(
  events: INetworkEventBus
): AsyncIterableEventBus<OutgoingRequestArgs, ResponseIncoming> {
  return {
    emitRequest: (data) => events.emit(NetworkEvent.reqRespOutgoingRequest, data),
    emitResponse: (data) => events.emit(NetworkEvent.reqRespIncomingResponse, data),
    onRequest: (cb) => events.on(NetworkEvent.reqRespOutgoingRequest, cb),
    onResponse: (cb) => events.on(NetworkEvent.reqRespIncomingResponse, cb),
  };
}

export function getReqRespBridgeRespEvents(
  events: INetworkEventBus
): AsyncIterableEventBus<IncomingRequestArgs, ResponseOutgoing> {
  return {
    emitRequest: (data) => events.emit(NetworkEvent.reqRespIncomingRequest, data),
    emitResponse: (data) => events.emit(NetworkEvent.reqRespOutgoingResponse, data),
    onRequest: (cb) => events.on(NetworkEvent.reqRespIncomingRequest, cb),
    onResponse: (cb) => events.on(NetworkEvent.reqRespOutgoingResponse, cb),
  };
}
