import {ContextBytesType, Encoding} from "@lodestar/reqresp";
import {ForkDigestContext} from "@lodestar/config";
import {
  ProtocolNoHandler,
  ReqRespMethod,
  Version,
  getRequestSzzTypeByMethod,
  responseSszTypeByMethod,
} from "./types.js";
import {rateLimitQuotas} from "./rateLimit.js";

/* eslint-disable @typescript-eslint/naming-convention */

export const Goodbye = toProtocol({
  method: ReqRespMethod.Goodbye,
  version: 1,
  contextBytesType: ContextBytesType.Empty,
});

export const Metadata = toProtocol({
  method: ReqRespMethod.Metadata,
  version: 1,
  contextBytesType: ContextBytesType.Empty,
});

export const MetadataV2 = toProtocol({
  method: ReqRespMethod.Metadata,
  version: 2,
  contextBytesType: ContextBytesType.Empty,
});

export const Ping = toProtocol({
  method: ReqRespMethod.Ping,
  version: 1,
  contextBytesType: ContextBytesType.Empty,
});

export const Status = toProtocol({
  method: ReqRespMethod.Status,
  version: 1,
  contextBytesType: ContextBytesType.Empty,
});

export const BeaconBlockAndBlobsSidecarByRoot = toProtocol({
  method: ReqRespMethod.BeaconBlockAndBlobsSidecarByRoot,
  version: 1,
  contextBytesType: ContextBytesType.ForkDigest,
});

export const BeaconBlocksByRange = toProtocol({
  method: ReqRespMethod.BeaconBlocksByRange,
  version: 1,
  contextBytesType: ContextBytesType.Empty,
});

export const BeaconBlocksByRangeV2 = toProtocol({
  method: ReqRespMethod.BeaconBlocksByRange,
  version: 2,
  contextBytesType: ContextBytesType.ForkDigest,
});

export const BeaconBlocksByRoot = toProtocol({
  method: ReqRespMethod.BeaconBlocksByRoot,
  version: 1,
  contextBytesType: ContextBytesType.Empty,
});

export const BeaconBlocksByRootV2 = toProtocol({
  method: ReqRespMethod.BeaconBlocksByRoot,
  version: 2,
  contextBytesType: ContextBytesType.ForkDigest,
});

export const BlobsSidecarsByRange = toProtocol({
  method: ReqRespMethod.BlobsSidecarsByRange,
  version: 1,
  contextBytesType: ContextBytesType.ForkDigest,
});

export const LightClientBootstrap = toProtocol({
  method: ReqRespMethod.LightClientBootstrap,
  version: 1,
  contextBytesType: ContextBytesType.ForkDigest,
});

export const LightClientFinalityUpdate = toProtocol({
  method: ReqRespMethod.LightClientFinalityUpdate,
  version: 1,
  contextBytesType: ContextBytesType.ForkDigest,
});

export const LightClientOptimisticUpdate = toProtocol({
  method: ReqRespMethod.LightClientOptimisticUpdate,
  version: 1,
  contextBytesType: ContextBytesType.ForkDigest,
});

export const LightClientUpdatesByRange = toProtocol({
  method: ReqRespMethod.LightClientUpdatesByRange,
  version: 1,
  contextBytesType: ContextBytesType.ForkDigest,
});

type ProtocolSummary = {
  method: ReqRespMethod;
  version: Version;
  contextBytesType: ContextBytesType;
};

function toProtocol(protocol: ProtocolSummary) {
  return (config: ForkDigestContext): ProtocolNoHandler => ({
    method: protocol.method,
    version: protocol.version,
    encoding: Encoding.SSZ_SNAPPY,
    contextBytes: {type: ContextBytesType.ForkDigest, forkDigestContext: config},
    inboundRateLimits: rateLimitQuotas[protocol.method],
    requestSizes: getRequestSzzTypeByMethod(protocol.method),
    responseSizes: (fork) => responseSszTypeByMethod[protocol.method](fork, protocol.version),
  });
}
