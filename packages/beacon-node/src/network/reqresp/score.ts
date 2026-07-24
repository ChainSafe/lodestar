import {RequestError, RequestErrorCode} from "@lodestar/reqresp";
import {PeerAction} from "../peers/score/index.js";
import {ReqRespMethod} from "./types.js";

/**
 * libp2p-ts does not include types for the error codes.
 * When libp2p has native types, this object won't be necessary.
 * https://github.com/libp2p/js-libp2p/blob/6350a187c7c207086e42436ccbcabd59af6f5e3d/src/errors.js#L32
 */
const libp2pErrorCodes = {
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
    case RequestErrorCode.INVALID_RESPONSE_SSZ:
    case RequestErrorCode.SSZ_OVER_MAX_SIZE:
      return PeerAction.LowToleranceError;

    case RequestErrorCode.SERVER_ERROR:
      return PeerAction.MidToleranceError;
    case RequestErrorCode.UNKNOWN_ERROR_STATUS:
      return PeerAction.HighToleranceError;

    case RequestErrorCode.DIAL_TIMEOUT:
    case RequestErrorCode.DIAL_ERROR:
      // `RequestError` renders `e.message` as just the error code (see `renderErrorMessage`), so the
      // multistream "protocol selection failed" text is only on the wrapped inner error, which is
      // available on `DIAL_ERROR` via `e.type.error` (`DIAL_TIMEOUT` carries no inner error).
      if (
        e.type.code === RequestErrorCode.DIAL_ERROR &&
        e.type.error.message.includes(multiStreamSelectErrorCodes.protocolSelectionFailed)
      ) {
        // Peer does not support the protocol, a real incompatibility rather than a transient
        // failure, so keep the stronger penalty (Fatal for Ping, as before).
        return method === ReqRespMethod.Ping ? PeerAction.Fatal : PeerAction.LowToleranceError;
      }
      switch (method) {
        // Ping and Status are liveness probes; their dial timeouts are dominated by transient
        // network congestion rather than peer misbehavior, so penalize leniently to avoid
        // self-inflicted peer starvation (https://github.com/ChainSafe/lodestar/issues/9562),
        // while still applying some penalty so genuinely dead peers eventually free the slot.
        case ReqRespMethod.Ping:
        case ReqRespMethod.Status:
          return PeerAction.HighToleranceError;
        default:
          return PeerAction.LowToleranceError;
      }
    // TODO: Detect SSZDecodeError and return PeerAction.Fatal

    case RequestErrorCode.RESP_TIMEOUT:
      switch (method) {
        case ReqRespMethod.Ping:
        case ReqRespMethod.Status:
        case ReqRespMethod.Metadata:
          return PeerAction.LowToleranceError;
        case ReqRespMethod.BeaconBlocksByRange:
        case ReqRespMethod.BeaconBlocksByRoot:
        case ReqRespMethod.BeaconBlocksByHead:
        case ReqRespMethod.ExecutionPayloadEnvelopesByRoot:
        case ReqRespMethod.ExecutionPayloadEnvelopesByRange:
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

  // other errors like RequestErrorCode.RESP_RATE_LIMITED could come from ourself, not the peer so we should not penalize them
  return null;
}
