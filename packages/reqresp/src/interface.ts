import {PeerId} from "@libp2p/interface-peer-id";
import {ForkName} from "@lodestar/params";
import {allForks, altair, phase0} from "@lodestar/types";
import {ReqRespProtocolModules} from "./ReqRespProtocol.js";
import {IPeerRpcScoreStore, MetadataController} from "./sharedTypes.js";
import {ProtocolDefinition, RequestTypedContainer} from "./types.js";

export interface IReqResp {
  start(): void;
  stop(): void;
  status(peerId: PeerId, request: phase0.Status): Promise<phase0.Status>;
  goodbye(peerId: PeerId, request: phase0.Goodbye): Promise<void>;
  ping(peerId: PeerId): Promise<phase0.Ping>;
  metadata(peerId: PeerId, fork?: ForkName): Promise<allForks.Metadata>;
  beaconBlocksByRange(
    peerId: PeerId,
    request: phase0.BeaconBlocksByRangeRequest
  ): Promise<allForks.SignedBeaconBlock[]>;
  beaconBlocksByRoot(peerId: PeerId, request: phase0.BeaconBlocksByRootRequest): Promise<allForks.SignedBeaconBlock[]>;
  pruneOnPeerDisconnect(peerId: PeerId): void;
  lightClientBootstrap(peerId: PeerId, request: Uint8Array): Promise<altair.LightClientBootstrap>;
  lightClientOptimisticUpdate(peerId: PeerId): Promise<altair.LightClientOptimisticUpdate>;
  lightClientFinalityUpdate(peerId: PeerId): Promise<altair.LightClientFinalityUpdate>;
  lightClientUpdate(peerId: PeerId, request: altair.LightClientUpdatesByRange): Promise<altair.LightClientUpdate[]>;
  registerProtocol<Req, Resp>(protocol: ProtocolDefinition<Req, Resp>): void;
}

export interface ReqRespModules extends ReqRespProtocolModules {
  peerRpcScores: IPeerRpcScoreStore;
  metadataController: MetadataController;
}

export interface ReqRespHandlerProtocolContext {
  modules: Omit<ReqRespProtocolModules, "libp2p">;
  eventHandlers: {
    onIncomingRequestBody(_req: RequestTypedContainer, _peerId: PeerId): void;
  };
}

export interface ReqRespHandlerContext extends ReqRespHandlerProtocolContext {
  modules: Omit<ReqRespProtocolModules, "libp2p"> & {
    inboundRateLimiter: RateLimiter;
    metadataController: MetadataController;
  };
}

/**
 * Rate limiter interface for inbound and outbound requests.
 */
export interface RateLimiter {
  /** Allow to request or response based on rate limit params configured. */
  allowRequest(peerId: PeerId): boolean;
  /** Rate limit check for block count */
  allowBlockByRequest(peerId: PeerId, numBlock: number): boolean;

  /**
   * Prune by peer id
   */
  prune(peerId: PeerId): void;
  start(): void;
  stop(): void;
}

//  Request/Response constants
export enum RespStatus {
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
  /**
   * The responder does not have requested resource.  The response payload adheres to the ErrorMessage schema (described below). Note: This response code is only valid as a response to BlocksByRange
   */
  RESOURCE_UNAVAILABLE = 3,
  /**
   * Our node does not have bandwidth to serve requests due to either per-peer quota or total quota.
   */
  RATE_LIMITED = 139,
}

export type RpcResponseStatusError = Exclude<RespStatus, RespStatus.SUCCESS>;
