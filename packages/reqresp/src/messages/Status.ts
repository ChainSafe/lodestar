import {phase0, ssz} from "@lodestar/types";
import {ContextBytesType, Encoding, ProtocolDefinitionGenerator} from "../types.js";
import {seconds} from "./utils.js";

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
       * Status is exchanged during handshake process, but peer can ask for it again.
       * We don't want to be flooded with status requests, so we limit it.
       * For total we multiply with `defaultNetworkOptions.maxPeers`
       */
      byPeer: {quota: 5, quotaTime: seconds(15)},
      total: {quota: 275, quotaTime: seconds(15)},
    },
  };
};
