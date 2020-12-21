import {Method} from "../../constants";
import {RpcScoreEvent} from "../peers/score";
import {TtfbTimeoutError} from "./errors";

export function successToScoreEvent(method: Method): RpcScoreEvent {
  if (method === Method.BeaconBlocksByRange) {
    return RpcScoreEvent.SUCCESS_BLOCK_RANGE;
  }

  if (method === Method.BeaconBlocksByRoot) {
    return RpcScoreEvent.SUCCESS_BLOCK_ROOT;
  }

  return RpcScoreEvent.NONE;
}

export function errorToScoreEvent(e: Error, method: Method): RpcScoreEvent {
  if (method === Method.BeaconBlocksByRange || method === Method.BeaconBlocksByRoot) {
    if (e instanceof TtfbTimeoutError) {
      return RpcScoreEvent.RESPONSE_TIMEOUT;
    }

    if (e.message.includes("ERR_UNSUPPORTED_PROTOCOL")) {
      return RpcScoreEvent.UNSUPPORTED_PROTOCOL;
    }

    return RpcScoreEvent.UNKNOWN_ERROR;
  }

  return RpcScoreEvent.NONE;
}
