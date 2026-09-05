import {BeaconConfig} from "@lodestar/config";
import {ForkName, MAX_DATA_COLUMN_SIDECAR_SIZE, isForkPostGloas} from "@lodestar/params";
import {ContextBytesFactory, ContextBytesType, Encoding, TypeSizes} from "@lodestar/reqresp";
import {rateLimitQuotas} from "./rateLimit.js";
import {ProtocolNoHandler, ReqRespMethod, Version, requestSszTypeByMethod, responseSszTypeByMethod} from "./types.js";

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

export const MetadataV3 = toProtocol({
  method: ReqRespMethod.Metadata,
  version: Version.V3,
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

export const StatusV2 = toProtocol({
  method: ReqRespMethod.Status,
  version: Version.V2,
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

export const BeaconBlocksByHead = toProtocol({
  method: ReqRespMethod.BeaconBlocksByHead,
  version: Version.V1,
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

export const DataColumnSidecarsByRange = toProtocol({
  method: ReqRespMethod.DataColumnSidecarsByRange,
  version: Version.V1,
  contextBytesType: ContextBytesType.ForkDigest,
});

export const DataColumnSidecarsByRoot = toProtocol({
  method: ReqRespMethod.DataColumnSidecarsByRoot,
  version: Version.V1,
  contextBytesType: ContextBytesType.ForkDigest,
});

export const ExecutionPayloadEnvelopesByRoot = toProtocol({
  method: ReqRespMethod.ExecutionPayloadEnvelopesByRoot,
  version: Version.V1,
  contextBytesType: ContextBytesType.ForkDigest,
});

export const ExecutionPayloadEnvelopesByRange = toProtocol({
  method: ReqRespMethod.ExecutionPayloadEnvelopesByRange,
  version: Version.V1,
  contextBytesType: ContextBytesType.ForkDigest,
});

export const InclusionListsByIndices = toProtocol({
  method: ReqRespMethod.InclusionListsByIndices,
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
  return (fork: ForkName, config: BeaconConfig): ProtocolNoHandler => {
    const requestType = requestSszTypeByMethod(fork, config)[protocol.method];
    return {
      method: protocol.method,
      version: protocol.version,
      encoding: Encoding.SSZ_SNAPPY,
      contextBytes: toContextBytes(protocol.contextBytesType, config),
      inboundRateLimits: rateLimitQuotas(fork, config)[protocol.method],
      requestSizes: requestType === null ? null : clampTypeSizes(requestType, protocol.method, fork, config),
      responseSizes: (fork) =>
        clampTypeSizes(responseSszTypeByMethod[protocol.method](fork, protocol.version), protocol.method, fork, config),
    };
  };
}

/**
 * Bound the sizes accepted from the ssz-snappy length-prefix. Gloas progressive containers have broad
 * theoretical SSZ max sizes so the preset p2p bounds must be used instead.
 *
 * The length-prefix must be within the size bounds derived from the payload SSZ type or `MAX_PAYLOAD_SIZE`,
 * whichever is smaller, see
 * https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.12/specs/phase0/p2p-interface.md#encoding-strategies.
 * Type-specific SSZ bounds supersede the bounds derived from the SSZ type, see
 * https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.12/specs/gloas/p2p-interface.md#type-specific-ssz-bounds.
 */
function clampTypeSizes(type: TypeSizes, method: ReqRespMethod, fork: ForkName, config: BeaconConfig): TypeSizes {
  let typeSpecificBound = config.MAX_PAYLOAD_SIZE;
  if (isForkPostGloas(fork)) {
    switch (method) {
      case ReqRespMethod.DataColumnSidecarsByRange:
      case ReqRespMethod.DataColumnSidecarsByRoot:
        typeSpecificBound = MAX_DATA_COLUMN_SIDECAR_SIZE;
        break;
    }
  }

  return {minSize: type.minSize, maxSize: Math.min(type.maxSize, typeSpecificBound)};
}

function toContextBytes(type: ContextBytesType, config: BeaconConfig): ContextBytesFactory {
  switch (type) {
    case ContextBytesType.Empty:
      return {type: ContextBytesType.Empty};
    case ContextBytesType.ForkDigest:
      return {type: ContextBytesType.ForkDigest, config};
  }
}
