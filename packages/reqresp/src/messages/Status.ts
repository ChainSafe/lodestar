import {phase0, ssz} from "@lodestar/types";
import {ContextBytesType, Encoding, ProtocolDefinitionGenerator} from "../types.js";
import {minutes} from "./utils.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const Status: ProtocolDefinitionGenerator<phase0.Status, phase0.Status> = (_modules, handler) => {
  return {
    method: "status",
    version: 1,
    encoding: Encoding.SSZ_SNAPPY,
    handler,
    requestType: () => ssz.phase0.Status,
    responseType: () => ssz.phase0.Status,
    contextBytes: {type: ContextBytesType.Empty},
    inboundRateLimits: {
      /**
       * As status is the first message for handshake we don't want to limit
       * it too restrictive allow more peers to connect
       */
      byPeer: {quota: 2, quotaTime: minutes(1)},
      total: {quota: 50, quotaTime: minutes(1)},
    },
  };
};
