import {PeerId} from "@libp2p/interface/peer-id";
import {BeaconConfig, ForkDigestContext} from "@lodestar/config";
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
 * Wrapper for the request/response payload
 */
export type ResponseIncoming = {
  data: Uint8Array;
  fork: ForkName;
  protocolVersion: number;
};

export type ResponseOutgoing = {
  data: Uint8Array;
  fork: ForkName;
};

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
export interface InboundRateLimitQuota {
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
  getRequestCount?: (req: Uint8Array) => number;
}

export type ReqRespRequest = {
  data: Uint8Array;
  version: number;
};

/**
 * Request handler
 */
export type ProtocolHandler = (req: ReqRespRequest, peerId: PeerId) => AsyncIterable<ResponseOutgoing>;

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

export interface ProtocolDescriptor extends Omit<ProtocolAttributes, "protocolPrefix"> {
  contextBytes: ContextBytesFactory;
  ignoreResponse?: boolean;
}

// `protocolPrefix` is added runtime so not part of definition
/**
 * ReqResp Protocol definition for full duplex protocols
 */
export interface Protocol extends ProtocolDescriptor {
  handler: ProtocolHandler;
  inboundRateLimits?: InboundRateLimitQuota;
  requestSizes: TypeSizes | null;
  responseSizes: (fork: ForkName) => TypeSizes;
}

/**
 * ReqResp Protocol definition for dial only protocols
 */
export interface DialOnlyProtocol extends Omit<Protocol, "handler" | "inboundRateLimits" | "renderRequestBody"> {
  handler?: never;
  inboundRateLimits?: never;
  renderRequestBody?: never;
}

/**
 * ReqResp Protocol definition for full duplex and dial only protocols
 */
export type MixedProtocol = DialOnlyProtocol | Protocol;

/**
 * ReqResp protocol definition descriptor for full duplex and dial only protocols
 * If handler is not provided, the protocol will be dial only
 * If handler is provided, the protocol will be full duplex
 */
export type MixedProtocolGenerators = <H extends ProtocolHandler | undefined = undefined>(
  // "inboundRateLimiter" is available only on handler context not on generator
  modules: {config: BeaconConfig},
  handler?: H
) => H extends undefined ? DialOnlyProtocol : Protocol;

/**
 * ReqResp protocol definition descriptor for full duplex protocols
 */
export type ProtocolGenerator = (modules: {config: BeaconConfig}, handler: ProtocolHandler) => Protocol;

export type HandlerTypeFromMessage<T> = T extends ProtocolGenerator ? ProtocolHandler : never;

export type ContextBytesFactory =
  | {type: ContextBytesType.Empty}
  | {type: ContextBytesType.ForkDigest; forkDigestContext: ForkDigestContext};

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

export type TypeSizes = {
  maxSize: number;
  minSize: number;
};
