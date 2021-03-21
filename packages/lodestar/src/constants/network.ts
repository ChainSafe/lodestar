import {IBeaconConfig} from "@chainsafe/lodestar-config";

/**
 * For more info on some of these constants:
 * https://github.com/ethereum/eth2.0-specs/blob/dev/specs/phase0/p2p-interface.md#configuration
 */

/**
 *
 * Gossip constants
 *
 */

/**
 * Rationale: https://github.com/ethereum/eth2.0-specs/blob/dev/specs/phase0/p2p-interface.md#why-are-there-attestation_subnet_count-attestation-subnets
 */
export const ATTESTATION_SUBNET_COUNT = 64;

/**
 * The maximum number of slots during which an attestation can be propagated.
 */
export const ATTESTATION_PROPAGATION_SLOT_RANGE = 23;

/**
 *
 * Request/Response constants
 *
 */

export type RequestId = string;

export enum Method {
  Status = "status",
  Goodbye = "goodbye",
  Ping = "ping",
  Metadata = "metadata",
  BeaconBlocksByRange = "beacon_blocks_by_range",
  BeaconBlocksByRoot = "beacon_blocks_by_root",
}

export enum MethodRequestType {
  "status" = "Status",
  "goodbye" = "Goodbye",
  "ping" = "Ping",
  "metadata" = "Metadata",
  "beacon_blocks_by_range" = "BeaconBlocksByRangeRequest",
  "beacon_blocks_by_root" = "BeaconBlocksByRootRequest",
}

export enum MethodResponseType {
  SingleResponse = "SingleResponse",
  Stream = "Stream",
}

/**
 * Request method types as defined by message types in:
 * https://github.com/ethereum/eth2.0-specs/blob/dev/specs/phase0/p2p-interface.md#messages
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const Methods = {
  [Method.Status]: {
    requestSSZType: (config: IBeaconConfig): typeof config.types.phase0.Status => config.types.phase0.Status,
    responseSSZType: (config: IBeaconConfig): typeof config.types.phase0.Status => config.types.phase0.Status,
    responseType: MethodResponseType.SingleResponse,
  },
  [Method.Goodbye]: {
    requestSSZType: (config: IBeaconConfig): typeof config.types.phase0.Goodbye => config.types.phase0.Goodbye,
    responseSSZType: (config: IBeaconConfig): typeof config.types.phase0.Goodbye => config.types.phase0.Goodbye,
    responseType: MethodResponseType.SingleResponse,
  },
  [Method.Ping]: {
    requestSSZType: (config: IBeaconConfig): typeof config.types.phase0.Ping => config.types.phase0.Ping,
    responseSSZType: (config: IBeaconConfig): typeof config.types.phase0.Ping => config.types.phase0.Ping,
    responseType: MethodResponseType.SingleResponse,
  },
  [Method.Metadata]: {
    requestSSZType: (): null => null,
    responseSSZType: (config: IBeaconConfig): typeof config.types.phase0.Metadata => config.types.phase0.Metadata,
    responseType: MethodResponseType.SingleResponse,
  },
  [Method.BeaconBlocksByRange]: {
    requestSSZType: (config: IBeaconConfig): typeof config.types.phase0.BeaconBlocksByRangeRequest =>
      config.types.phase0.BeaconBlocksByRangeRequest,
    responseSSZType: (config: IBeaconConfig): typeof config.types.phase0.SignedBeaconBlock =>
      config.types.phase0.SignedBeaconBlock,
    responseType: MethodResponseType.Stream,
  },
  [Method.BeaconBlocksByRoot]: {
    requestSSZType: (config: IBeaconConfig): typeof config.types.phase0.BeaconBlocksByRootRequest =>
      config.types.phase0.BeaconBlocksByRootRequest,
    responseSSZType: (config: IBeaconConfig): typeof config.types.phase0.SignedBeaconBlock =>
      config.types.phase0.SignedBeaconBlock,
    responseType: MethodResponseType.Stream,
  },
};

/**
 * Available request/response encoding strategies:
 * https://github.com/ethereum/eth2.0-specs/blob/dev/specs/phase0/p2p-interface.md#encoding-strategies
 */
export enum ReqRespEncoding {
  SSZ_SNAPPY = "ssz_snappy",
}

export enum RpcResponseStatus {
  /**
   * A normal response follows, with contents matching the expected message schema and encoding specified in the request
   */
  SUCCESS = 0,
  /**
   * The contents of the request are semantically invalid, or the payload is malformed,
   * or could not be understood. The response payload adheres to the ErrorMessage schema
   */
  INVALID_REQUEST = 1,
  /**
   * The responder encountered an error while processing the request. The response payload adheres to the ErrorMessage schema
   */
  SERVER_ERROR = 2,
}

export type RpcResponseStatusError = Exclude<RpcResponseStatus, RpcResponseStatus.SUCCESS>;

/** The maximum allowed size of uncompressed gossip messages. */
export const GOSSIP_MAX_SIZE = 2 ** 20;
/** The maximum allowed size of uncompressed req/resp chunked responses. */
export const MAX_CHUNK_SIZE = 2 ** 20;

/** The maximum time to wait for first byte of request response (time-to-first-byte). */
export const TTFB_TIMEOUT = 5 * 1000; // 5 sec
/** The maximum time for complete response transfer. */
export const RESP_TIMEOUT = 10 * 1000; // 10 sec
/** Non-spec timeout from sending request until write stream closed by responder */
export const REQUEST_TIMEOUT = 5 * 1000; // 5 sec
/** Non-spec timeout from dialing protocol until stream opened */
export const DIAL_TIMEOUT = 5 * 1000; // 5 sec
// eslint-disable-next-line @typescript-eslint/naming-convention
export const timeoutOptions = {TTFB_TIMEOUT, RESP_TIMEOUT, REQUEST_TIMEOUT, DIAL_TIMEOUT};

export enum GoodByeReasonCode {
  CLIENT_SHUTDOWN = 1,
  IRRELEVANT_NETWORK = 2,
  ERROR = 3,
  TOO_MANY_PEERS = 129,
  SCORE_TOO_LOW = 250,
  BANNED = 251,
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const GOODBYE_KNOWN_CODES: Record<string, string> = {
  0: "Unknown",

  // spec-defined codes
  1: "Client shutdown",
  2: "Irrelevant network",
  3: "Internal fault/error",

  // Teku-defined codes
  128: "Unable to verify network",

  // Lighthouse-defined codes
  129: "Client has too many peers",
  250: "Peer score too low",
  251: "Peer banned this node",
};

/** Until js-libp2p types its events */
export enum Libp2pEvent {
  peerConnect = "peer:connect",
  peerDisconnect = "peer:disconnect",
}
