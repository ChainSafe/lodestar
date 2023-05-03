import {ForkDigestContext} from "@lodestar/config";
import {ssz} from "@lodestar/types";
import {ForkLightClient, ForkName, isForkLightClient} from "@lodestar/params";
import {
  ContextBytesFactory,
  ContextBytesType,
  Encoding,
  ProtocolNoHandler,
  ReqRespEncoder,
  ReqRespMethod,
  Version,
} from "./types.js";
import {rateLimitQuotas} from "./rateLimit.js";
/* eslint-disable @typescript-eslint/naming-convention */

function onlyLightclientFork(fork: ForkName): ForkLightClient {
  if (isForkLightClient(fork)) {
    return fork;
  } else {
    throw Error(`Not a lightclient fork ${fork}`);
  }
}

export const Goodbye = toProtocol({
  method: ReqRespMethod.Goodbye,
  version: Version.V1,
  contextBytesType: ContextBytesType.Empty,
  requestEncoder: ssz.phase0.Goodbye,
  responseEncoder: () => ssz.phase0.Goodbye,
});

export const Metadata = toProtocol({
  method: ReqRespMethod.Metadata,
  version: Version.V1,
  contextBytesType: ContextBytesType.Empty,
  requestEncoder: null,
  responseEncoder: () => ssz.phase0.Metadata,
});

export const MetadataV2 = toProtocol({
  method: ReqRespMethod.Metadata,
  version: Version.V2,
  contextBytesType: ContextBytesType.Empty,
  requestEncoder: null,
  responseEncoder: () => ssz.altair.Metadata,
});

export const Ping = toProtocol({
  method: ReqRespMethod.Ping,
  version: Version.V1,
  contextBytesType: ContextBytesType.Empty,
  requestEncoder: ssz.phase0.Ping,
  responseEncoder: () => ssz.phase0.Ping,
});

export const Status = toProtocol({
  method: ReqRespMethod.Status,
  version: Version.V1,
  contextBytesType: ContextBytesType.Empty,
  requestEncoder: ssz.phase0.Status,
  responseEncoder: () => ssz.phase0.Status,
});

export const BeaconBlockAndBlobsSidecarByRoot = toProtocol({
  method: ReqRespMethod.BeaconBlockAndBlobsSidecarByRoot,
  version: Version.V1,
  contextBytesType: ContextBytesType.ForkDigest,
  requestEncoder: ssz.deneb.BeaconBlockAndBlobsSidecarByRootRequest,
  responseEncoder: () => ssz.deneb.SignedBeaconBlockAndBlobsSidecar,
});

export const BeaconBlocksByRange = toProtocol({
  method: ReqRespMethod.BeaconBlocksByRange,
  version: Version.V1,
  contextBytesType: ContextBytesType.Empty,
  requestEncoder: ssz.phase0.BeaconBlocksByRangeRequest,
  responseEncoder: (fork) => ssz[fork].SignedBeaconBlock,
});

export const BeaconBlocksByRangeV2 = toProtocol({
  method: ReqRespMethod.BeaconBlocksByRange,
  version: Version.V2,
  contextBytesType: ContextBytesType.ForkDigest,
  requestEncoder: ssz.phase0.BeaconBlocksByRangeRequest,
  responseEncoder: (fork) => ssz[fork].SignedBeaconBlock,
});

export const BeaconBlocksByRoot = toProtocol({
  method: ReqRespMethod.BeaconBlocksByRoot,
  version: Version.V1,
  contextBytesType: ContextBytesType.Empty,
  requestEncoder: ssz.phase0.BeaconBlocksByRootRequest,
  responseEncoder: () => ssz.phase0.SignedBeaconBlock,
});

export const BeaconBlocksByRootV2 = toProtocol({
  method: ReqRespMethod.BeaconBlocksByRoot,
  version: Version.V2,
  contextBytesType: ContextBytesType.ForkDigest,
  requestEncoder: ssz.phase0.BeaconBlocksByRootRequest,
  responseEncoder: (fork) => ssz[fork].SignedBeaconBlock,
});

export const BlobsSidecarsByRange = toProtocol({
  method: ReqRespMethod.BlobsSidecarsByRange,
  version: Version.V1,
  contextBytesType: ContextBytesType.ForkDigest,
  requestEncoder: ssz.deneb.BlobsSidecarsByRangeRequest,
  responseEncoder: () => ssz.deneb.BlobsSidecar,
});

export const LightClientBootstrap = toProtocol({
  method: ReqRespMethod.LightClientBootstrap,
  version: Version.V1,
  contextBytesType: ContextBytesType.ForkDigest,
  requestEncoder: ssz.Root,
  responseEncoder: (fork) => ssz.allForksLightClient[onlyLightclientFork(fork)].LightClientBootstrap,
});

export const LightClientFinalityUpdate = toProtocol({
  method: ReqRespMethod.LightClientFinalityUpdate,
  version: Version.V1,
  contextBytesType: ContextBytesType.ForkDigest,
  requestEncoder: null,
  responseEncoder: (fork) => ssz.allForksLightClient[onlyLightclientFork(fork)].LightClientFinalityUpdate,
});

export const LightClientOptimisticUpdate = toProtocol({
  method: ReqRespMethod.LightClientOptimisticUpdate,
  version: Version.V1,
  contextBytesType: ContextBytesType.ForkDigest,
  requestEncoder: null,
  responseEncoder: (fork) => ssz.allForksLightClient[onlyLightclientFork(fork)].LightClientOptimisticUpdate,
});

export const LightClientUpdatesByRange = toProtocol({
  method: ReqRespMethod.LightClientUpdatesByRange,
  version: Version.V1,
  contextBytesType: ContextBytesType.ForkDigest,
  requestEncoder: ssz.altair.LightClientUpdatesByRange,
  responseEncoder: (fork) => ssz.allForksLightClient[onlyLightclientFork(fork)].LightClientUpdate,
});

type ProtocolSummary<Req, Resp> = {
  method: ReqRespMethod;
  version: Version;
  contextBytesType: ContextBytesType;
  requestEncoder: ReqRespEncoder<Req> | null;
  responseEncoder: (fork: ForkName) => ReqRespEncoder<Resp>;
};

function toProtocol<Req, Resp>(protocol: ProtocolSummary<Req, Resp>) {
  return (config: ForkDigestContext): ProtocolNoHandler<Req, Resp> => ({
    method: protocol.method,
    version: protocol.version,
    encoding: Encoding.SSZ_SNAPPY,
    contextBytes: toContextBytes(protocol.contextBytesType, config),
    inboundRateLimits: rateLimitQuotas[protocol.method],
    requestEncoder: protocol.requestEncoder,
    responseEncoder: protocol.responseEncoder,
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
