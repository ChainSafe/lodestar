import {PeerId} from "@libp2p/interface-peer-id";
import {BeaconConfig, ForkConfig, ForkDigestContext} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {LodestarError} from "@lodestar/utils";
import {RateLimiterQuota} from "./rate_limiter/rateLimiterGRCA.js";

export const protocolPrefix = "/eth2/beacon_chain/req";

/**
 * Available request/response encoding strategies:
 * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md#encoding-strategies
 */
export enum Encoding {
  SSZ_SNAPPY = "ssz_snappy",
}

export const CONTEXT_BYTES_FORK_DIGEST_LENGTH = 4;

/**
 * The encoding of the request/response payload
 */
export enum EncodedPayloadType {
  ssz,
  bytes,
}

export interface EncodedPayloadData<T = unknown> extends Record<EncodedPayloadType, unknown> {
  [EncodedPayloadType.ssz]: {
    type: EncodedPayloadType.ssz;
    data: T;
  };
  [EncodedPayloadType.bytes]: {
    type: EncodedPayloadType.bytes;
    bytes: Uint8Array;
    contextBytes: ContextBytes;
  };
}

/**
 * Wrapper for the request/response payload for binary type data
 */
export type EncodedPayloadBytes = EncodedPayloadData[EncodedPayloadType.bytes];
/**
 * Wrapper for the request/response payload for ssz type data
 */
export type EncodedPayloadSsz<T = unknown> = EncodedPayloadData<T>[EncodedPayloadType.ssz];

/**
 * Wrapper for the request/response payload
 */
export type EncodedPayload<T> = EncodedPayloadData<T>[EncodedPayloadType];

/**
 * Rate limiter options for the requests
 */
export interface ReqRespRateLimiterOpts {
  rateLimitMultiplier?: number;
  onRateLimit?: (peer: PeerId, method: string) => void;
}

/**
 * Inbound rate limiter quota for the protocol
 */
export interface InboundRateLimitQuota<Req = unknown> {
  /**
   * Will be tracked for the protocol per peer
   */
  byPeer?: RateLimiterQuota;
  /**
   * Will be tracked regardless of the peer
   */
  total?: RateLimiterQuota;
  /**
   * Some requests may be counted multiple e.g. getBlocksByRange
   * for such implement this method else `1` will be used default
   */
  getRequestCount?: (req: Req) => number;
}

/**
 * Request handler
 */
export type ProtocolHandler<Req, Resp> = (
  protocol: ProtocolDescriptor<Req, Resp>,
  req: Req,
  peerId: PeerId
) => AsyncIterable<EncodedPayloadBytes>;

/**
 * ReqResp Protocol Deceleration
 */
export interface ProtocolAttributes {
  readonly protocolPrefix: string;
  /** Protocol name identifier `beacon_blocks_by_range` or `status` */
  readonly method: string;
  /** Version counter: `1`, `2` etc */
  readonly version: number;
  readonly encoding: Encoding;
}

export interface ProtocolDescriptor<Req = unknown, Resp = unknown> extends Omit<ProtocolAttributes, "protocolPrefix"> {
  requestType: (fork: ForkName) => TypeSerializer<Req> | null;
  responseType: (fork: ForkName) => TypeSerializer<Resp>;
  contextBytes: ContextBytesFactory<Resp>;
  ignoreResponse?: boolean;
}

// `protocolPrefix` is added runtime so not part of definition
/**
 * ReqResp Protocol definition for full duplex protocols
 */
export interface Protocol<Req = unknown, Resp = unknown> extends ProtocolDescriptor<Req, Resp> {
  handler: ProtocolHandler<Req, Resp>;
  renderRequestBody?: (request: Req) => string;
  inboundRateLimits?: InboundRateLimitQuota<Req>;
}

/**
 * ReqResp Protocol definition for dial only protocols
 */
export interface DialOnlyProtocol<Req = unknown, Resp = unknown>
  extends Omit<Protocol<Req, Resp>, "handler" | "inboundRateLimits" | "renderRequestBody"> {
  handler?: never;
  inboundRateLimits?: never;
  renderRequestBody?: never;
}

/**
 * ReqResp Protocol definition for full duplex and dial only protocols
 */
export type MixedProtocol<Req = unknown, Resp = unknown> = DialOnlyProtocol<Req, Resp> | Protocol<Req, Resp>;

/**
 * ReqResp protocol definition descriptor for full duplex and dial only protocols
 * If handler is not provided, the protocol will be dial only
 * If handler is provided, the protocol will be full duplex
 */
export type MixedProtocolGenerator<Req, Resp> = <H extends ProtocolHandler<Req, Resp> | undefined = undefined>(
  // "inboundRateLimiter" is available only on handler context not on generator
  modules: {config: BeaconConfig},
  handler?: H
) => H extends undefined ? DialOnlyProtocol<Req, Resp> : Protocol<Req, Resp>;

/**
 * ReqResp protocol definition descriptor for full duplex protocols
 */
export type ProtocolGenerator<Req, Resp> = (
  modules: {config: BeaconConfig},
  handler: ProtocolHandler<Req, Resp>
) => Protocol<Req, Resp>;

export type HandlerTypeFromMessage<T> = T extends ProtocolGenerator<infer Req, infer Resp>
  ? ProtocolHandler<Req, Resp>
  : never;

export type ContextBytesFactory<Resp> =
  | {type: ContextBytesType.Empty}
  | {
      type: ContextBytesType.ForkDigest;
      forkDigestContext: ForkDigestContext & Pick<ForkConfig, "getForkName">;
      forkFromResponse: (response: Resp) => ForkName;
    };

export type ContextBytes = {type: ContextBytesType.Empty} | {type: ContextBytesType.ForkDigest; fork: ForkName};

export enum ContextBytesType {
  /** 0 bytes chunk, can be ignored */
  Empty,
  /** A fixed-width 4 byte <context-bytes>, set to the ForkDigest matching the chunk: compute_fork_digest(fork_version, genesis_validators_root) */
  ForkDigest,
}

export enum LightClientServerErrorCode {
  RESOURCE_UNAVAILABLE = "RESOURCE_UNAVAILABLE",
}

export type LightClientServerErrorType = {code: LightClientServerErrorCode.RESOURCE_UNAVAILABLE};

export class LightClientServerError extends LodestarError<LightClientServerErrorType> {}

/**
 * Lightweight interface of ssz Type<T>
 */
export interface TypeSerializer<T> {
  serialize(data: T): Uint8Array;
  deserialize(bytes: Uint8Array): T;
  maxSize: number;
  minSize: number;
  equals(a: T, b: T): boolean;
}
