import {PeerId} from "@libp2p/interface-peer-id";
import {BeaconConfig, ForkConfig, ForkDigestContext} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {Slot} from "@lodestar/types";
import {LodestarError} from "@lodestar/utils";
import {RateLimiterQuota} from "./rate_limiter/rateLimiterGRCA.js";

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
 * The encoding of the request/response payload
 */
export enum PayloadType {
  ssz = 1,
  bytes = 2,
}

export interface EncodedPayloadOutgoingData<T = unknown> extends Record<PayloadType, unknown> {
  [PayloadType.ssz]: {
    type: PayloadType.ssz;
    data: T;
  };
  [PayloadType.bytes]: {
    type: PayloadType.bytes;
    bytes: Uint8Array;
    contextBytes: ContextBytes;
  };
}

export interface EncodedPayloadIncomingData<T = unknown> extends Record<PayloadType, unknown> {
  [PayloadType.ssz]: {
    type: PayloadType.ssz;
    data: T;
  };
  [PayloadType.bytes]: {
    type: PayloadType.bytes;
    bytes: Uint8Array;
  };
}

/**
 * Wrapper for the request/response payload for binary type data
 */
export type EncodedPayloadBytes = EncodedPayloadOutgoingData[PayloadType.bytes];
/**
 * Wrapper for the request/response payload for ssz type data
 */
export type EncodedPayloadSsz<T = unknown> = EncodedPayloadOutgoingData<T>[PayloadType.ssz];

/**
 * Wrapper for the request/response payload
 */
export type EncodedPayload<T> = EncodedPayloadOutgoingData<T>[PayloadType];

export const protocolPrefix = "/eth2/beacon_chain/req";

/**
 * ReqResp Protocol Deceleration
 */
export interface ProtocolStaticAttrs {
  readonly protocolPrefix: string;
  /** Protocol name identifier `beacon_blocks_by_range` or `status` */
  readonly method: string;
  /** Version counter: `1`, `2` etc */
  readonly version: number;
  readonly encoding: Encoding;
}

export interface ProtocolDescriptor<Req = unknown, Resp = unknown> extends Omit<ProtocolStaticAttrs, "protocolPrefix"> {
  requestEncoder: (fork: ForkName) => TypeEncoder<Req> | null;
  responseEncoder: (fork: ForkName) => TypeEncoder<Resp>;
  contextBytes: ContextBytesFactory<Resp>;
  ignoreResponse?: boolean;
}

/**
 * Protocol handler
 * Make the default payload type to bytes
 */
export type ProtocolHandler<Req, Resp, PType extends PayloadType = PayloadType.bytes> = (
  protocol: ProtocolDescriptor<Req, Resp>,
  req: EncodedPayloadIncomingData<Req>[PType],
  peerId: PeerId
) => AsyncIterable<EncodedPayloadOutgoingData<Resp>[PType]>;

// `protocolPrefix` is added runtime so not part of definition
/**
 * ReqResp Protocol definition for full duplex protocols
 */
export interface Protocol<Req = unknown, Resp = unknown, PType extends PayloadType = PayloadType>
  extends ProtocolDescriptor<Req, Resp> {
  handler: ProtocolHandler<Req, Resp, PayloadType>;
  payloadType: PType;
  renderRequestBody?: (request: Req) => string;
  inboundRateLimits?: InboundRateLimitQuota<Req>;
}

/**
 * ReqResp Protocol definition for dial only protocols
 */
export interface DialOnlyProtocol<Req = unknown, Resp = unknown>
  extends Omit<Protocol<Req, Resp>, "handler" | "inboundRateLimits" | "renderRequestBody" | "payloadType"> {
  handler?: never;
  inboundRateLimits?: never;
  renderRequestBody?: never;
  payloadType?: never;
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
export type MixedProtocolGenerator<Req, Resp, PType extends PayloadType = PayloadType> = <
  H extends ProtocolHandler<Req, Resp, PType> | undefined = undefined
>(
  // "inboundRateLimiter" is available only on handler context not on generator
  modules: {config: BeaconConfig},
  handler?: H,
  payloadType?: PType
) => H extends undefined ? DialOnlyProtocol<Req, Resp> : Protocol<Req, Resp, PType>;

/**
 * ReqResp protocol definition descriptor for full duplex protocols
 */
export type ProtocolGenerator<Req, Resp, PType extends PayloadType = PayloadType> = (
  modules: {config: BeaconConfig},
  handler: ProtocolHandler<Req, Resp, PType>,
  payloadType: PType
) => Protocol<Req, Resp>;

export type HandlerTypeFromMessage<T> = T extends ProtocolGenerator<infer Req, infer Resp, infer PType>
  ? ProtocolHandler<Req, Resp, PType>
  : never;

/**
 * Available request/response encoding strategies:
 * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md#encoding-strategies
 */
export enum Encoding {
  SSZ_SNAPPY = "ssz_snappy",
}

export const CONTEXT_BYTES_FORK_DIGEST_LENGTH = 4;

export type ContextBytesFactory<Resp> =
  | {type: ContextBytesType.Empty}
  | {
      type: ContextBytesType.ForkDigest;
      forkDigestContext: ForkDigestContext & Pick<ForkConfig, "getForkName">;
      forkFromResponse: (response: Resp) => ForkName;
    };

export type ContextBytes = {type: ContextBytesType.Empty} | {type: ContextBytesType.ForkDigest; forkSlot: Slot};

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
export interface TypeEncoder<T> {
  serialize(data: T): Uint8Array;
  deserialize(bytes: Uint8Array): T;
  maxSize: number;
  minSize: number;
  equals(a: T, b: T): boolean;
}
