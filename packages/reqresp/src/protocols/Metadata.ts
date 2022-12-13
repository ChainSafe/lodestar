import {allForks, ssz} from "@lodestar/types";
import {ContextBytesType, Encoding, ProtocolDefinition, ProtocolDefinitionGenerator} from "../types.js";

/* eslint-disable @typescript-eslint/naming-convention */
const MetadataCommon: Pick<
  ProtocolDefinition<null, allForks.Metadata>,
  "method" | "encoding" | "requestType" | "renderRequestBody" | "inboundRateLimits"
> = {
  method: "metadata",
  encoding: Encoding.SSZ_SNAPPY,
  requestType: () => null,
  inboundRateLimits: {
    // Rationale: https://github.com/sigp/lighthouse/blob/bf533c8e42cc73c35730e285c21df8add0195369/beacon_node/lighthouse_network/src/rpc/mod.rs#L118-L130
    byPeer: {quota: 2, quotaTimeMs: 5_000},
  },
};

export const Metadata: ProtocolDefinitionGenerator<null, allForks.Metadata> = (modules, handler) => {
  return {
    ...MetadataCommon,
    version: 1,
    handler,
    responseType: () => ssz.phase0.Metadata,
    contextBytes: {type: ContextBytesType.Empty},
  };
};

export const MetadataV2: ProtocolDefinitionGenerator<null, allForks.Metadata> = (modules, handler) => {
  return {
    ...MetadataCommon,
    version: 2,
    handler,
    responseType: () => ssz.altair.Metadata,
    contextBytes: {type: ContextBytesType.Empty},
  };
};
