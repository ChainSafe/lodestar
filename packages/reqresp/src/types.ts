import {PeerId} from "@libp2p/interface-peer-id";
import {Type} from "@chainsafe/ssz";
import {IForkConfig, IForkDigestContext} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {phase0, Slot} from "@lodestar/types";
import {LodestarError} from "@lodestar/utils";
import {ReqRespEventsHandlers, ReqRespHandlerContext, ReqRespModules} from "./interface.js";
import {timeoutOptions} from "./constants.js";

export enum EncodedPayloadType {
  ssz,
  bytes,
}

export type EncodedPayload<T> =
  | {
      type: EncodedPayloadType.ssz;
      data: T;
    }
  | {
      type: EncodedPayloadType.bytes;
      bytes: Uint8Array;
      contextBytes: ContextBytes;
    };

export type HandlerWithContext<Req, Resp> = (
  context: ReqRespHandlerContext,
  req: Req,
  peerId: PeerId
) => AsyncIterable<EncodedPayload<Resp>>;

export type Handler<Req, Resp> = (req: Req, peerId: PeerId) => AsyncIterable<EncodedPayload<Resp>>;

export interface ProtocolDefinition<Req = unknown, Resp = unknown> extends Protocol {
  handler: HandlerWithContext<Req, Resp>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requestType: (fork: ForkName) => Type<Req> | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  responseType: (fork: ForkName) => Type<Resp>;
  renderRequestBody?: (request: Req) => string;
  contextBytes: ContextBytesFactory<Resp>;
  isSingleResponse: boolean;
}

export type ProtocolDefinitionGenerator<Req, Res> = (
  handler: Handler<Req, Res>,
  modules: ReqRespModules
) => ProtocolDefinition<Req, Res>;

export const protocolPrefix = "/eth2/beacon_chain/req";

/** ReqResp protocol names or methods. Each Method can have multiple versions and encodings */
export enum Method {
  // Phase 0
  Status = "status",
  Goodbye = "goodbye",
  Ping = "ping",
  Metadata = "metadata",
  BeaconBlocksByRange = "beacon_blocks_by_range",
  BeaconBlocksByRoot = "beacon_blocks_by_root",
  LightClientBootstrap = "light_client_bootstrap",
  LightClientUpdatesByRange = "light_client_updates_by_range",
  LightClientFinalityUpdate = "light_client_finality_update",
  LightClientOptimisticUpdate = "light_client_optimistic_update",
}

// To typesafe events to network
type RequestBodyByMethod = {
  [Method.Status]: phase0.Status;
  [Method.Goodbye]: phase0.Goodbye;
  [Method.Ping]: phase0.Ping;
  [Method.Metadata]: null;
  // Do not matter
  [Method.BeaconBlocksByRange]: unknown;
  [Method.BeaconBlocksByRoot]: unknown;
  [Method.LightClientBootstrap]: unknown;
  [Method.LightClientUpdatesByRange]: unknown;
  [Method.LightClientFinalityUpdate]: unknown;
  [Method.LightClientOptimisticUpdate]: unknown;
};

export type RequestTypedContainer = {
  [K in Method]: {method: K; body: RequestBodyByMethod[K]};
}[Method];

/** RPC Versions */
export enum Version {
  V1 = "1",
  V2 = "2",
}

/**
 * Available request/response encoding strategies:
 * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md#encoding-strategies
 */
export enum Encoding {
  SSZ_SNAPPY = "ssz_snappy",
}

export type Protocol = {
  method: Method;
  version: Version;
  encoding: Encoding;
};

export const CONTEXT_BYTES_FORK_DIGEST_LENGTH = 4;

export type ContextBytesFactory<Response> =
  | {type: ContextBytesType.Empty}
  | {
      type: ContextBytesType.ForkDigest;
      forkDigestContext: IForkDigestContext & Pick<IForkConfig, "getForkName">;
      forkFromResponse: (response: Response) => ForkName;
    };

export type ContextBytes = {type: ContextBytesType.Empty} | {type: ContextBytesType.ForkDigest; forkSlot: Slot};

export enum ContextBytesType {
  /** 0 bytes chunk, can be ignored */
  Empty,
  /** A fixed-width 4 byte <context-bytes>, set to the ForkDigest matching the chunk: compute_fork_digest(fork_version, genesis_validators_root) */
  ForkDigest,
}

export type ReqRespOptions = typeof timeoutOptions & ReqRespEventsHandlers;

export enum LightClientServerErrorCode {
  RESOURCE_UNAVAILABLE = "RESOURCE_UNAVAILABLE",
}

export type LightClientServerErrorType = {code: LightClientServerErrorCode.RESOURCE_UNAVAILABLE};

export class LightClientServerError extends LodestarError<LightClientServerErrorType> {}
