import {phase0, ssz} from "@lodestar/types";
import {ContextBytesType, DialOnlyProtocol, Encoding, MixedProtocolGenerator} from "../types.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const Status: MixedProtocolGenerator<phase0.Status, phase0.Status> = ((_modules, handler, payloadType) => {
  const dialProtocol: DialOnlyProtocol<phase0.Status, phase0.Status> = {
    method: "status",
    version: 1,
    encoding: Encoding.SSZ_SNAPPY,
    requestEncoder: () => ssz.phase0.Status,
    responseEncoder: () => ssz.phase0.Status,
    contextBytes: {type: ContextBytesType.Empty},
  };

  if (!handler) return dialProtocol;

  return {
    ...dialProtocol,
    payloadType,
    handler,
    inboundRateLimits: {
      // Rationale: https://github.com/sigp/lighthouse/blob/bf533c8e42cc73c35730e285c21df8add0195369/beacon_node/lighthouse_network/src/rpc/mod.rs#L118-L130
      byPeer: {quota: 5, quotaTimeMs: 15_000},
    },
  };
}) as MixedProtocolGenerator<phase0.Status, phase0.Status>;
