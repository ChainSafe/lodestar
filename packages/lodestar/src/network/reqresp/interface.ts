import LibP2p from "libp2p";
import PeerId from "peer-id";
import {ForkName} from "@chainsafe/lodestar-params";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {allForks, phase0} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IPeerRpcScoreStore} from "../peers/index.js";
import {MetadataController} from "../metadata.js";
import {INetworkEventBus} from "../events.js";
import {PeersData} from "../peers/peersData.js";
import {ReqRespHandlers} from "./handlers/index.js";
import {IMetrics} from "../../metrics/index.js";
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
}

export interface IReqRespModules {
  config: IBeaconConfig;
  libp2p: LibP2p;
  peersData: PeersData;
  logger: ILogger;
  metadata: MetadataController;
  reqRespHandlers: ReqRespHandlers;
  peerRpcScores: IPeerRpcScoreStore;
  networkEventBus: INetworkEventBus;
  metrics: IMetrics | null;
}

export type Libp2pConnection = {
  stream: Libp2pStream;
  /**
   * When dialing a protocol you may request multiple protocols by order of preference.
   * Libp2p will negotiate a protocol and the one stablished will be returned in this variable.
   * Example value: `'/eth2/beacon_chain/req/metadata/1/ssz_snappy'`
   */
  protocol: string;
};

/**
 * Stream types from libp2p.dialProtocol are too vage and cause compilation type issues
 * These source and sink types are more precise to our usage
 */
export type Libp2pStream = {
  source: AsyncIterable<Buffer>;
  sink: (source: AsyncIterable<Buffer>) => Promise<void>;
  /**
   * `libp2p-mplex`: Close for reading
   * ```ts
   * () => stream.source.end()
   * ```
   */
  close: () => void;
  /**
   * `libp2p-mplex`: Close immediately for reading and writing (remote error)
   */
  reset: () => void;
  /**
   * `libp2p-mplex`: Close for reading and writing (local error)
   */
  abort: (err: Error) => void;
};

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
