/**
 * @module network
 */
import {ENR} from "@chainsafe/discv5/lib";
import {
  BeaconBlocksByRangeRequest,
  BeaconBlocksByRootRequest,
  Goodbye,
  Metadata,
  Ping,
  SignedBeaconBlock,
  Status,
} from "@chainsafe/lodestar-types";
import {EventEmitter} from "events";
import LibP2p from "libp2p";
import Multiaddr from "multiaddr";
import PeerId from "peer-id";
import StrictEventEmitter from "strict-event-emitter-types";
import {IGossip} from "./gossip/interface";
import {MetadataController} from "./metadata";
import {IPeerMetadataStore} from "./peers/interface";
import {IRpcScoreTracker} from "./peers/score";
import {ReqRespHandler} from "./reqresp";

export interface IReqResp {
  status(peerId: PeerId, request: Status): Promise<Status>;
  goodbye(peerId: PeerId, request: Goodbye): Promise<void>;
  ping(peerId: PeerId, request: Ping): Promise<Ping>;
  metadata(peerId: PeerId): Promise<Metadata>;
  beaconBlocksByRange(peerId: PeerId, request: BeaconBlocksByRangeRequest): Promise<SignedBeaconBlock[]>;
  beaconBlocksByRoot(peerId: PeerId, request: BeaconBlocksByRootRequest): Promise<SignedBeaconBlock[]>;
  registerHandler(handler: ReqRespHandler): void;
  unregisterHandler(): ReqRespHandler | null;
}

export enum NetworkEvent {
  peerConnect = "peer:connect",
  peerDisconnect = "peer:disconnect",
  gossipStart = "gossip:start",
  gossipStop = "gossip:stop",
  gossipHeartbeat = "gossipsub:heartbeat",
}

export interface INetworkEvents {
  [NetworkEvent.peerConnect]: (peerId: PeerId, direction: "inbound" | "outbound") => void;
  [NetworkEvent.peerDisconnect]: (peerId: PeerId) => void;
}
export type NetworkEventEmitter = StrictEventEmitter<EventEmitter, INetworkEvents>;

export type PeerSearchOptions = {
  supportsProtocols: string[];
  count?: number;
};

export interface INetwork extends NetworkEventEmitter {
  reqResp: IReqResp;
  gossip: IGossip;
  metadata: MetadataController;
  peerMetadata: IPeerMetadataStore;
  peerRpcScores: IRpcScoreTracker;
  /**
   * Our network identity
   */
  peerId: PeerId;
  localMultiaddrs: Multiaddr[];
  getEnr(): ENR | undefined;
  getPeers(opts?: Partial<PeerSearchOptions>): LibP2p.Peer[];
  getAllPeers(): LibP2p.Peer[];
  getMaxPeer(): number;
  /**
   * Get the instance of a connection with a given peer.
   */
  getPeerConnection(peerId: PeerId): LibP2pConnection | null;
  /**
   * Checks to see whether or not we are connected to a given peer.
   */
  hasPeer(peerId: PeerId): boolean;
  /**
   * Connect to given peer(s).
   */
  connect(peerId: PeerId, localMultiaddrs?: Multiaddr[]): Promise<void>;
  /**
   * Disconnect from given peer.
   */
  disconnect(peerId: PeerId): Promise<void>;
  /**
   * Search peers joining subnets.
   */
  searchSubnetPeers(subnets: string[]): Promise<void>;
  // Service
  start(): Promise<void>;
  stop(): Promise<void>;
  handleSyncCompleted(): Promise<void>;
}
