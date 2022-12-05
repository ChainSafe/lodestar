import {phase0, ssz} from "@lodestar/types";
import {ContextBytesType, Encoding, ProtocolDefinitionGenerator} from "../types.js";
import {minutes} from "./utils.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const Goodbye: ProtocolDefinitionGenerator<phase0.Goodbye, phase0.Goodbye> = (_modules, handler) => {
  return {
    method: "goodbye",
    version: 1,
    encoding: Encoding.SSZ_SNAPPY,
    handler,
    requestType: () => ssz.phase0.Goodbye,
    responseType: () => ssz.phase0.Goodbye,
    renderRequestBody: (req) => req.toString(10),
    contextBytes: {type: ContextBytesType.Empty},
    inboundRateLimits: {
      /**
       * Metadata is part of handshake process, so we keep it
       * equivalent to status message
       */
      byPeer: {quota: 2, quotaTime: minutes(1)},
      total: {quota: 50, quotaTime: minutes(1)},
    },
  };
};
