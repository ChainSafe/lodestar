import {phase0, ssz} from "@lodestar/types";
import {ContextBytesType, Encoding, ProtocolDefinition, ReqRespHandler} from "../types.js";
import {seconds} from "./utils.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export function Ping(handler: ReqRespHandler<phase0.Ping, phase0.Ping>): ProtocolDefinition<phase0.Ping, phase0.Ping> {
  return {
    method: "ping",
    version: 1,
    encoding: Encoding.SSZ_SNAPPY,
    handler,
    requestType: () => ssz.phase0.Ping,
    responseType: () => ssz.phase0.Ping,
    renderRequestBody: (req) => req.toString(10),
    contextBytes: {type: ContextBytesType.Empty},
    inboundRateLimits: {
      /**
       * Ping is a very light message, we can allow more peers to connect
       */
      byPeer: {quota: 1, quotaTime: seconds(10)},
      total: {quota: 50, quotaTime: seconds(10)},
    },
  };
}
