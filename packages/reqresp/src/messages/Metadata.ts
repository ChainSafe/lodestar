import {allForks, ssz} from "@lodestar/types";
import {ContextBytesType, Encoding, ProtocolDefinitionGenerator} from "../types.js";
import {minutes} from "./utils.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const Metadata: ProtocolDefinitionGenerator<null, allForks.Metadata> = (modules, handler) => {
  return {
    method: "metadata",
    version: 1,
    encoding: Encoding.SSZ_SNAPPY,
    handler,
    requestType: () => null,
    responseType: () => ssz.phase0.Metadata,
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
