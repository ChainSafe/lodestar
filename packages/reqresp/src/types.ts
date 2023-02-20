import {PeerId} from "@libp2p/interface-peer-id";
import {BeaconConfig, ForkConfig, ForkDigestContext} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {Slot} from "@lodestar/types";
import {LodestarError} from "@lodestar/utils";
import {RateLimiterQuota} from "./rate_limiter/rateLimiterGRCA.js";

export enum EncodedPayloadType {
  ssz,
  bytes,
}

export interface EncodedPayloadSsz<T> {
  type: EncodedPayloadType.ssz;
  data: T;
}

export interface EncodedPayloadBytes {
  type: EncodedPayloadType.bytes;
  bytes: Uint8Array;
  contextBytes: ContextBytes;
}

export type EncodedPayload<T> = EncodedPayloadSsz<T> | EncodedPayloadBytes;

export type ReqRespHandler<Req, Resp> = (req: Req, peerId: PeerId) => AsyncIterable<EncodedPayload<Resp>>;

export interface Protocol {
  readonly protocolPrefix: string;
  /** Protocol name identifier `beacon_blocks_by_range` or `status` */
  readonly method: string;
  /** Version counter: `1`, `2` etc */
  readonly version: number;
  readonly encoding: Encoding;
}

export interface InboundRateLimitQuota<Req = unknown> {
  // Will be tracked for the protocol per peer
  byPeer?: RateLimiterQuota;
  // Will be tracked regardless of the peer
  total?: RateLimiterQuota;
  // Some requests may be counted multiple e.g. getBlocksByRange
  // for such implement this method else `1` will be used default
  getRequestCount?: (req: Req) => number;
}

// `protocolPrefix` is added runtime so not part of definition
export interface ProtocolDefinition<Req = unknown, Resp = unknown> extends Omit<Protocol, "protocolPrefix"> {
  handler: ReqRespHandler<Req, Resp>;
  requestType: (fork: ForkName) => TypeSerializer<Req> | null;
  responseType: (fork: ForkName) => TypeSerializer<Resp>;
  ignoreResponse?: boolean;
  renderRequestBody?: (request: Req) => string;
  contextBytes: ContextBytesFactory<Resp>;
  inboundRateLimits?: InboundRateLimitQuota<Req>;
}

export type ProtocolDefinitionGenerator<Req, Res> = (
  // "inboundRateLimiter" is available only on handler context not on generator
  modules: {config: BeaconConfig},
  handler: ReqRespHandler<Req, Res>
) => ProtocolDefinition<Req, Res>;

export type HandlerTypeFromMessage<T> = T extends ProtocolDefinitionGenerator<infer Req, infer Res>
  ? ReqRespHandler<Req, Res>
  : never;

export const protocolPrefix = "/eth2/beacon_chain/req";

/**
 * Available request/response encoding strategies:
 * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md#encoding-strategies
 */
export enum Encoding {
  SSZ_SNAPPY = "ssz_snappy",
}

export const CONTEXT_BYTES_FORK_DIGEST_LENGTH = 4;

export type ContextBytesFactory<Response> =
  | {type: ContextBytesType.Empty}
  | {
      type: ContextBytesType.ForkDigest;
      forkDigestContext: ForkDigestContext & Pick<ForkConfig, "getForkName">;
      forkFromResponse: (response: Response) => ForkName;
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
export interface TypeSerializer<T> {
  serialize(data: T): Uint8Array;
  deserialize(bytes: Uint8Array): T;
  maxSize: number;
  minSize: number;
  equals(a: T, b: T): boolean;
}

export interface ReqRespRateLimiterOpts {
  rateLimitMultiplier?: number;
  onRateLimit?: (peer: PeerId, method: string) => void;
}
