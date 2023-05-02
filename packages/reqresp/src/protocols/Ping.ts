import {phase0, ssz} from "@lodestar/types";
import {ContextBytesType, Encoding, ProtocolGenerator} from "../types.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const Ping: ProtocolGenerator<phase0.Ping, phase0.Ping> = (_modules, handler) => {
  return {
    method: "ping",
    version: 1,
    encoding: Encoding.SSZ_SNAPPY,
    handler,
    requestEncoder: () => ssz.phase0.Ping,
    responseEncoder: () => ssz.phase0.Ping,
    renderRequestBody: (req) => req.toString(10),
    contextBytes: {type: ContextBytesType.Empty},
    inboundRateLimits: {
      // Rationale: https://github.com/sigp/lighthouse/blob/bf533c8e42cc73c35730e285c21df8add0195369/beacon_node/lighthouse_network/src/rpc/mod.rs#L118-L130
      byPeer: {quota: 2, quotaTimeMs: 10_000},
    },
  };
};
