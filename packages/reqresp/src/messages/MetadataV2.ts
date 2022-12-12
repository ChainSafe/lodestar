import {allForks, ssz} from "@lodestar/types";
import {ContextBytesType, Encoding, ProtocolDefinitionGenerator} from "../types.js";
import {metadataInboundRateLimit} from "./Metadata.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const MetadataV2: ProtocolDefinitionGenerator<null, allForks.Metadata> = (modules, handler) => {
  return {
    method: "metadata",
    version: 2,
    encoding: Encoding.SSZ_SNAPPY,
    handler,
    requestType: () => null,
    responseType: () => ssz.altair.Metadata,
    contextBytes: {type: ContextBytesType.Empty},
    inboundRateLimits: metadataInboundRateLimit,
  };
};
