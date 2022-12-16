import {phase0, ssz} from "@lodestar/types";
import {ContextBytesType, Encoding, ProtocolDefinitionGenerator} from "../types.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const Goodbye: ProtocolDefinitionGenerator<phase0.Goodbye, phase0.Goodbye> = (_modules, handler) => {
  return {
    method: "goodbye",
    version: 1,
    encoding: Encoding.SSZ_SNAPPY,
    handler,
    requestType: () => ssz.phase0.Goodbye,
    responseType: () => ssz.phase0.Goodbye,
    ignoreResponse: true,
    renderRequestBody: (req) => req.toString(10),
    contextBytes: {type: ContextBytesType.Empty},
    inboundRateLimits: {
      // Rationale: https://github.com/sigp/lighthouse/blob/bf533c8e42cc73c35730e285c21df8add0195369/beacon_node/lighthouse_network/src/rpc/mod.rs#L118-L130
      byPeer: {quota: 1, quotaTimeMs: 10_000},
    },
  };
};
