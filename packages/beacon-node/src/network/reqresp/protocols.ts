import {ContextBytesFactory, ContextBytesType, Encoding} from "@lodestar/reqresp";
import {ForkDigestContext} from "@lodestar/config";
import {ProtocolNoHandler, ReqRespMethod, Version, requestSszTypeByMethod, responseSszTypeByMethod} from "./types.js";
import {rateLimitQuotas} from "./rateLimit.js";

export const Goodbye = toProtocol({
  method: ReqRespMethod.Goodbye,
  version: Version.V1,
  contextBytesType: ContextBytesType.Empty,
});

export const Metadata = toProtocol({
  method: ReqRespMethod.Metadata,
  version: Version.V1,
  contextBytesType: ContextBytesType.Empty,
});

export const MetadataV2 = toProtocol({
  method: ReqRespMethod.Metadata,
  version: Version.V2,
  contextBytesType: ContextBytesType.Empty,
});

export const Ping = toProtocol({
  method: ReqRespMethod.Ping,
  version: Version.V1,
  contextBytesType: ContextBytesType.Empty,
});

export const Status = toProtocol({
  method: ReqRespMethod.Status,
  version: Version.V1,
  contextBytesType: ContextBytesType.Empty,
});

export const BeaconBlocksByRange = toProtocol({
  method: ReqRespMethod.BeaconBlocksByRange,
  version: Version.V1,
  contextBytesType: ContextBytesType.Empty,
});

export const BeaconBlocksByRangeV2 = toProtocol({
  method: ReqRespMethod.BeaconBlocksByRange,
  version: Version.V2,
  contextBytesType: ContextBytesType.ForkDigest,
});

export const BeaconBlocksByRoot = toProtocol({
  method: ReqRespMethod.BeaconBlocksByRoot,
  version: Version.V1,
  contextBytesType: ContextBytesType.Empty,
});

export const BeaconBlocksByRootV2 = toProtocol({
  method: ReqRespMethod.BeaconBlocksByRoot,
  version: Version.V2,
  contextBytesType: ContextBytesType.ForkDigest,
});

export const BlobSidecarsByRange = toProtocol({
  method: ReqRespMethod.BlobSidecarsByRange,
  version: Version.V1,
  contextBytesType: ContextBytesType.ForkDigest,
});

export const BlobSidecarsByRoot = toProtocol({
  method: ReqRespMethod.BlobSidecarsByRoot,
  version: Version.V1,
  contextBytesType: ContextBytesType.ForkDigest,
});

export const LightClientBootstrap = toProtocol({
  method: ReqRespMethod.LightClientBootstrap,
  version: Version.V1,
  contextBytesType: ContextBytesType.ForkDigest,
});

export const LightClientFinalityUpdate = toProtocol({
  method: ReqRespMethod.LightClientFinalityUpdate,
  version: Version.V1,
  contextBytesType: ContextBytesType.ForkDigest,
});

export const LightClientOptimisticUpdate = toProtocol({
  method: ReqRespMethod.LightClientOptimisticUpdate,
  version: Version.V1,
  contextBytesType: ContextBytesType.ForkDigest,
});

export const LightClientUpdatesByRange = toProtocol({
  method: ReqRespMethod.LightClientUpdatesByRange,
  version: Version.V1,
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
    contextBytes: toContextBytes(protocol.contextBytesType, config),
    inboundRateLimits: rateLimitQuotas[protocol.method],
    requestSizes: requestSszTypeByMethod[protocol.method],
    responseSizes: (fork) => responseSszTypeByMethod[protocol.method](fork, protocol.version),
  });
}

function toContextBytes(type: ContextBytesType, config: ForkDigestContext): ContextBytesFactory {
  switch (type) {
    case ContextBytesType.Empty:
      return {type: ContextBytesType.Empty};
    case ContextBytesType.ForkDigest:
      return {type: ContextBytesType.ForkDigest, forkDigestContext: config};
  }
}
