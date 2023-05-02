import {PeerId} from "@libp2p/interface-peer-id";
import {Multiaddr} from "@multiformats/multiaddr";
import {PublishResult} from "@libp2p/interface-pubsub";
import {Observable} from "@chainsafe/threads/observable";
import {routes} from "@lodestar/api";
import {ResponseIncoming} from "@lodestar/reqresp";
import {PeerScoreStatsDump} from "@chainsafe/libp2p-gossipsub/score";
import {phase0} from "@lodestar/types";
import {PublishOpts} from "@chainsafe/libp2p-gossipsub/types";
import {PendingGossipsubMessage} from "../processor/types.js";
import {NetworkOptions} from "../options.js";
import {CommitteeSubscription} from "../subnets/interface.js";
import {PeerAction, PeerScoreStats} from "../peers/index.js";
import {OutgoingRequestArgs} from "../reqresp/types.js";

// Interface shared by main Network class, and all backends
export interface INetworkCorePublic {
  // Peer manager control
  prepareBeaconCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void>;
  prepareSyncCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void>;
  reStatusPeers(peers: PeerId[]): Promise<void>;
  // reportPeer - Different interface depending on the backend

  // REST API getters
  getNetworkIdentity(): Promise<routes.node.NetworkIdentity>;

  // Gossip control
  subscribeGossipCoreTopics(): Promise<void>;
  unsubscribeGossipCoreTopics(): Promise<void>;

  // Debug
  connectToPeer(peer: PeerId, multiaddr: Multiaddr[]): Promise<void>;
  disconnectPeer(peer: PeerId): Promise<void>;
  dumpPeers(): Promise<routes.lodestar.LodestarNodePeer[]>;
  dumpPeer(peerIdStr: string): Promise<routes.lodestar.LodestarNodePeer | undefined>;
  dumpPeerScoreStats(): Promise<PeerScoreStats>;
  dumpGossipPeerScoreStats(): Promise<PeerScoreStatsDump>;
  dumpDiscv5KadValues(): Promise<string[]>;
  dumpMeshPeers(): Promise<Record<string, string[]>>;
}

/**
 * Contains core network functionality (libp2p and dependent modules)
 *
 * All properties/methods should be async to allow for a worker implementation
 */
export interface INetworkCore extends INetworkCorePublic {
  // Sync method
  reportPeer(peer: PeerId, action: PeerAction, actionName: string): void;

  // TODO: Duplicated methods with INetwork interface
  getConnectedPeers(): Promise<PeerId[]>;
  getConnectedPeerCount(): Promise<number>;

  /** Chain must push status updates to the network core */
  updateStatus(status: phase0.Status): Promise<void>;

  /** Opens stream to handle ReqResp outgoing request */
  sendReqRespRequest(data: OutgoingRequestArgs): AsyncIterable<ResponseIncoming>;
  /** Publish gossip message to peers */
  publishGossip(topic: string, data: Uint8Array, opts?: PublishOpts): Promise<PublishResult>;

  close(): Promise<void>;
  scrapeMetrics(): Promise<string>;
}

/**
 * libp2p worker contructor (start-up) data
 */
export type NetworkWorkerData = {
  // TODO: Review if NetworkOptions is safe for passing
  opts: NetworkOptions;
  chainConfigJson: Record<string, string>;
  genesisValidatorsRoot: Uint8Array;
  genesisTime: number;
  activeValidatorCount: number;
  initialStatus: phase0.Status;
  peerIdProto: Uint8Array;
  localMultiaddrs: string[];
  metrics: boolean;
  peerStoreDir?: string;
};

/**
 * API exposed by the libp2p worker
 */
export type NetworkWorkerApi = INetworkCorePublic & {
  // TODO: Gossip events
  // Main -> Worker: NetworkEvent.gossipMessageValidationResult
  // Worker -> Main: NetworkEvent.pendingGossipsubMessage
  pendingGossipsubMessage(): Observable<PendingGossipsubMessage>;

  // Async method through worker boundary
  reportPeer(peer: PeerId, action: PeerAction, actionName: string): Promise<void>;

  // TODO: Duplicated methods with INetwork interface
  getConnectedPeers(): Promise<PeerId[]>;
  getConnectedPeerCount(): Promise<number>;
  updateStatus(status: phase0.Status): Promise<void>;

  // sendReqRespRequest - implemented via events
  publishGossip(topic: string, data: Uint8Array, opts?: PublishOpts): Promise<PublishResult>;

  close(): Promise<void>;
  scrapeMetrics(): Promise<string>;

  // TODO: ReqResp outgoing
  // TODO: ReqResp incoming
};
