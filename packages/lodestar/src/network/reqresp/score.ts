import {Method} from "../../constants";
import {RpcScoreEvent} from "../peers/score";
import {RequestError, RequestErrorCode} from "./request";

/**
 * libp2p-ts does not include types for the error codes.
 * When libp2p has native types, this object won't be necessary.
 * https://github.com/libp2p/js-libp2p/blob/6350a187c7c207086e42436ccbcabd59af6f5e3d/src/errors.js#L32
 */
const libp2pErrorCodes = {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  ERR_UNSUPPORTED_PROTOCOL: "ERR_UNSUPPORTED_PROTOCOL",
};

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
  if (e.message.includes(libp2pErrorCodes.ERR_UNSUPPORTED_PROTOCOL)) {
    return RpcScoreEvent.UNSUPPORTED_PROTOCOL;
  }

  if (method === Method.BeaconBlocksByRange || method === Method.BeaconBlocksByRoot) {
    if (e instanceof RequestError) {
      switch (e.type.code) {
        case RequestErrorCode.TTFB_TIMEOUT:
          return RpcScoreEvent.RESPONSE_TIMEOUT;
      }
    }

    return RpcScoreEvent.UNKNOWN_ERROR;
  }

  return RpcScoreEvent.NONE;
}
