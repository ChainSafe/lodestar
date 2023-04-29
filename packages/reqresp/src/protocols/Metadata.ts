import {allForks, ssz} from "@lodestar/types";
import {ContextBytesType, ProtocolGenerator, Encoding, MixedProtocol} from "../types.js";

/* eslint-disable @typescript-eslint/naming-convention */
const MetadataCommon: Pick<
  MixedProtocol<null, allForks.Metadata>,
  "method" | "encoding" | "requestEncoder" | "renderRequestBody" | "inboundRateLimits" | "payloadType"
> = {
  method: "metadata",
  encoding: Encoding.SSZ_SNAPPY,
  requestEncoder: () => null,
  inboundRateLimits: {
    // Rationale: https://github.com/sigp/lighthouse/blob/bf533c8e42cc73c35730e285c21df8add0195369/beacon_node/lighthouse_network/src/rpc/mod.rs#L118-L130
    byPeer: {quota: 2, quotaTimeMs: 5_000},
  },
};

export const Metadata: ProtocolGenerator<null, allForks.Metadata> = (modules, handler, payloadType) => {
  return {
    ...MetadataCommon,
    version: 1,
    handler,
    payloadType,
    responseEncoder: () => ssz.phase0.Metadata,
    contextBytes: {type: ContextBytesType.Empty},
  };
};

export const MetadataV2: ProtocolGenerator<null, allForks.Metadata> = (modules, handler, payloadType) => {
  return {
    ...MetadataCommon,
    version: 2,
    handler,
    payloadType,
    responseEncoder: () => ssz.altair.Metadata,
    contextBytes: {type: ContextBytesType.Empty},
  };
};
