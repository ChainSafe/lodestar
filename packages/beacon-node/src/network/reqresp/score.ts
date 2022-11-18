import {RequestError, RequestErrorCode} from "@lodestar/reqresp";
import {PeerAction} from "../peers/score.js";
import {ReqRespMethod} from "./types.js";

/**
 * libp2p-ts does not include types for the error codes.
 * When libp2p has native types, this object won't be necessary.
 * https://github.com/libp2p/js-libp2p/blob/6350a187c7c207086e42436ccbcabd59af6f5e3d/src/errors.js#L32
 */
const libp2pErrorCodes = {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  ERR_UNSUPPORTED_PROTOCOL: "ERR_UNSUPPORTED_PROTOCOL",
};

/**
 * Multi stream select error code
 * https://github.com/multiformats/js-multistream-select/blame/cf4e297b362a43bde2ea117085ceba78cbce1c12/src/select.js#L50
 */
const multiStreamSelectErrorCodes = {
  protocolSelectionFailed: "protocol selection failed",
};

export function onOutgoingReqRespError(e: RequestError, method: ReqRespMethod): PeerAction | null {
  switch (e.type.code) {
    case RequestErrorCode.INVALID_REQUEST:
      return PeerAction.LowToleranceError;

    case RequestErrorCode.SERVER_ERROR:
      return PeerAction.MidToleranceError;
    case RequestErrorCode.UNKNOWN_ERROR_STATUS:
      return PeerAction.HighToleranceError;

    case RequestErrorCode.DIAL_TIMEOUT:
    case RequestErrorCode.DIAL_ERROR:
      return e.message.includes(multiStreamSelectErrorCodes.protocolSelectionFailed) && method === ReqRespMethod.Ping
        ? PeerAction.Fatal
        : PeerAction.LowToleranceError;
    // TODO: Detect SSZDecodeError and return PeerAction.Fatal

    case RequestErrorCode.TTFB_TIMEOUT:
    case RequestErrorCode.RESP_TIMEOUT:
      switch (method) {
        case ReqRespMethod.Ping:
          return PeerAction.LowToleranceError;
        case ReqRespMethod.BeaconBlocksByRange:
        case ReqRespMethod.BeaconBlocksByRoot:
          return PeerAction.MidToleranceError;
        default:
          return null;
      }
  }

  if (e.message.includes(libp2pErrorCodes.ERR_UNSUPPORTED_PROTOCOL)) {
    switch (method) {
      case ReqRespMethod.Ping:
        return PeerAction.Fatal;
      case ReqRespMethod.Metadata:
      case ReqRespMethod.Status:
        return PeerAction.LowToleranceError;
      default:
        return null;
    }
  }

  return null;
}
