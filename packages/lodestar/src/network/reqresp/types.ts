import {ForkName} from "@chainsafe/lodestar-params";
import {allForks, phase0, ssz, Slot} from "@chainsafe/lodestar-types";

export const protocolPrefix = "/eth2/beacon_chain/req";

/** ReqResp protocol names or methods. Each Method can have multiple versions and encodings */
export enum Method {
  Status = "status",
  Goodbye = "goodbye",
  Ping = "ping",
  Metadata = "metadata",
  BeaconBlocksByRange = "beacon_blocks_by_range",
  BeaconBlocksByRoot = "beacon_blocks_by_root",
}

/** RPC Versions */
export enum Version {
  V1 = "1",
  V2 = "2",
}

/**
 * Available request/response encoding strategies:
 * https://github.com/ethereum/eth2.0-specs/blob/dev/specs/phase0/p2p-interface.md#encoding-strategies
 */
export enum Encoding {
  SSZ_SNAPPY = "ssz_snappy",
}

export type Protocol = {
  method: Method;
  version: Version;
  encoding: Encoding;
};

export const protocolsSupported: [Method, Version, Encoding][] = [
  [Method.Status, Version.V1, Encoding.SSZ_SNAPPY],
  [Method.Goodbye, Version.V1, Encoding.SSZ_SNAPPY],
  [Method.Ping, Version.V1, Encoding.SSZ_SNAPPY],
  [Method.Metadata, Version.V1, Encoding.SSZ_SNAPPY],
  [Method.Metadata, Version.V2, Encoding.SSZ_SNAPPY],
  [Method.BeaconBlocksByRange, Version.V1, Encoding.SSZ_SNAPPY],
  [Method.BeaconBlocksByRange, Version.V2, Encoding.SSZ_SNAPPY],
  [Method.BeaconBlocksByRoot, Version.V1, Encoding.SSZ_SNAPPY],
  [Method.BeaconBlocksByRoot, Version.V2, Encoding.SSZ_SNAPPY],
];

export const isSingleResponseChunkByMethod: {[K in Method]: boolean} = {
  [Method.Status]: true, // Exactly 1 response chunk
  [Method.Goodbye]: true,
  [Method.Ping]: true,
  [Method.Metadata]: true,
  [Method.BeaconBlocksByRange]: false, // A stream, 0 or more response chunks
  [Method.BeaconBlocksByRoot]: false,
};

/** Deserialize some types to TreeBacked directly for more efficient hashing */
export const deserializeToTreeByMethod: {[K in Method]: boolean} = {
  [Method.Status]: false,
  [Method.Goodbye]: false,
  [Method.Ping]: false,
  [Method.Metadata]: false,
  [Method.BeaconBlocksByRange]: true,
  [Method.BeaconBlocksByRoot]: true,
};

export const CONTEXT_BYTES_FORK_DIGEST_LENGTH = 4;
export enum ContextBytesType {
  /** 0 bytes chunk, can be ignored */
  Empty,
  /** A fixed-width 4 byte <context-bytes>, set to the ForkDigest matching the chunk: compute_fork_digest(fork_version, genesis_validators_root) */
  ForkDigest,
}

/** Meaning of the <context-bytes> chunk per protocol */
export function contextBytesTypeByProtocol(protocol: Protocol): ContextBytesType {
  switch (protocol.method) {
    case Method.Status:
    case Method.Goodbye:
    case Method.Ping:
    case Method.Metadata:
      return ContextBytesType.Empty;
    case Method.BeaconBlocksByRange:
    case Method.BeaconBlocksByRoot:
      switch (protocol.version) {
        case Version.V1:
          return ContextBytesType.Empty;
        case Version.V2:
          return ContextBytesType.ForkDigest;
      }
  }
}

/** Request SSZ type for each method and ForkName */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/explicit-function-return-type
export function getRequestSzzTypeByMethod(method: Method) {
  switch (method) {
    case Method.Status:
      return ssz.phase0.Status;
    case Method.Goodbye:
      return ssz.phase0.Goodbye;
    case Method.Ping:
      return ssz.phase0.Ping;
    case Method.Metadata:
      return null;
    case Method.BeaconBlocksByRange:
      return ssz.phase0.BeaconBlocksByRangeRequest;
    case Method.BeaconBlocksByRoot:
      return ssz.phase0.BeaconBlocksByRootRequest;
  }
}

export type RequestBodyByMethod = {
  [Method.Status]: phase0.Status;
  [Method.Goodbye]: phase0.Goodbye;
  [Method.Ping]: phase0.Ping;
  [Method.Metadata]: null;
  [Method.BeaconBlocksByRange]: phase0.BeaconBlocksByRangeRequest;
  [Method.BeaconBlocksByRoot]: phase0.BeaconBlocksByRootRequest;
};

/** Response SSZ type for each method and ForkName */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/explicit-function-return-type
export function getResponseSzzTypeByMethod(protocol: Protocol, forkName: ForkName) {
  switch (protocol.method) {
    case Method.Status:
      return ssz.phase0.Status;
    case Method.Goodbye:
      return ssz.phase0.Goodbye;
    case Method.Ping:
      return ssz.phase0.Ping;
    case Method.Metadata: {
      // V1 -> phase0.Metadata, V2 -> altair.Metadata
      const fork = protocol.version === Version.V1 ? ForkName.phase0 : ForkName.altair;
      return ssz[fork].Metadata;
    }
    case Method.BeaconBlocksByRange:
    case Method.BeaconBlocksByRoot:
      // SignedBeaconBlock type is changed in altair
      return ssz[forkName].SignedBeaconBlock;
  }
}

/** Return either an ssz type or the serializer for ReqRespBlockResponse */
export function getOutgoingSerializerByMethod(protocol: Protocol): OutgoingSerializer {
  switch (protocol.method) {
    case Method.Status:
      return ssz.phase0.Status;
    case Method.Goodbye:
      return ssz.phase0.Goodbye;
    case Method.Ping:
      return ssz.phase0.Ping;
    case Method.Metadata: {
      // V1 -> phase0.Metadata, V2 -> altair.Metadata
      const fork = protocol.version === Version.V1 ? ForkName.phase0 : ForkName.altair;
      return ssz[fork].Metadata;
    }
    case Method.BeaconBlocksByRange:
    case Method.BeaconBlocksByRoot:
      return reqRespBlockResponseSerializer;
  }
}

type CommonResponseBodyByMethod = {
  [Method.Status]: phase0.Status;
  [Method.Goodbye]: phase0.Goodbye;
  [Method.Ping]: phase0.Ping;
  [Method.Metadata]: phase0.Metadata;
};

// Used internally by lodestar to response to beacon_blocks_by_range and beacon_blocks_by_root
// without having to deserialize and serialize from/to bytes
export type OutgoingResponseBodyByMethod = CommonResponseBodyByMethod & {
  [Method.BeaconBlocksByRange]: ReqRespBlockResponse;
  [Method.BeaconBlocksByRoot]: ReqRespBlockResponse;
};

// p2p protocol in the spec
export type IncomingResponseBodyByMethod = CommonResponseBodyByMethod & {
  [Method.BeaconBlocksByRange]: allForks.SignedBeaconBlock;
  [Method.BeaconBlocksByRoot]: allForks.SignedBeaconBlock;
};

// Helper types to generically define the arguments of the encoder functions

export type RequestBody = RequestBodyByMethod[Method];
export type OutgoingResponseBody = OutgoingResponseBodyByMethod[Method];
export type IncomingResponseBody = IncomingResponseBodyByMethod[Method];
export type RequestOrIncomingResponseBody = RequestBody | IncomingResponseBody;
export type RequestOrOutgoingResponseBody = RequestBody | OutgoingResponseBody;

export type RequestType = Exclude<ReturnType<typeof getRequestSzzTypeByMethod>, null>;
export type ResponseType = ReturnType<typeof getResponseSzzTypeByMethod>;
export type RequestOrResponseType = RequestType | ResponseType;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OutgoingSerializer = {serialize: (body: any) => Uint8Array};

// Link each method with its type for more type-safe event handlers

export type RequestTypedContainer = {
  [K in Method]: {method: K; body: RequestBodyByMethod[K]};
}[Method];
export type ResponseTypedContainer = {
  [K in Method]: {method: K; body: OutgoingResponseBodyByMethod[K]};
}[Method];

/** Serializer for ReqRespBlockResponse */
export const reqRespBlockResponseSerializer = {
  serialize: (chunk: ReqRespBlockResponse): Uint8Array => {
    return chunk.bytes;
  },
};

/** This type helps response to beacon_block_by_range and beacon_block_by_root more efficiently */
export type ReqRespBlockResponse = {
  /** Deserialized data of allForks.SignedBeaconBlock */
  bytes: Uint8Array;
  slot: Slot;
};
