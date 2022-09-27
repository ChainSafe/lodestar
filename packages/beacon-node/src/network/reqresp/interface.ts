import {Libp2p} from "libp2p";
import {PeerId} from "@libp2p/interface-peer-id";
import {ForkName} from "@lodestar/params";
import {IBeaconConfig} from "@lodestar/config";
import {allForks, altair, phase0} from "@lodestar/types";
import {ILogger} from "@lodestar/utils";
import {IPeerRpcScoreStore} from "../peers/index.js";
import {MetadataController} from "../metadata.js";
import {INetworkEventBus} from "../events.js";
import {PeersData} from "../peers/peersData.js";
import {IMetrics} from "../../metrics/index.js";
import {ReqRespHandlers} from "./handlers/index.js";
import {RequestTypedContainer} from "./types.js";

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
}

export interface IReqRespModules {
  config: IBeaconConfig;
  libp2p: Libp2p;
  peersData: PeersData;
  logger: ILogger;
  metadata: MetadataController;
  reqRespHandlers: ReqRespHandlers;
  peerRpcScores: IPeerRpcScoreStore;
  networkEventBus: INetworkEventBus;
  metrics: IMetrics | null;
}

/**
 * Rate limiter interface for inbound and outbound requests.
 */
export interface IRateLimiter {
  /**
   * Allow to request or response based on rate limit params configured.
   */
  allowRequest(peerId: PeerId, requestTyped: RequestTypedContainer): boolean;

  /**
   * Prune by peer id
   */
  prune(peerId: PeerId): void;
  start(): void;
  stop(): void;
}
