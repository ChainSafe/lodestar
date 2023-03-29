import {Multiaddr} from "@multiformats/multiaddr";
import {PeerId} from "@libp2p/interface-peer-id";
import {PeerScoreStatsDump} from "@chainsafe/libp2p-gossipsub/score";
import {routes} from "@lodestar/api";
import {phase0} from "@lodestar/types";
import {PeerAction, PeerScoreStats} from "../peers/index.js";
import {CommitteeSubscription} from "../subnets/interface.js";
import {PublisherBeaconNode} from "../gossip/interface.js";
import {IReqRespBeaconNode} from "../reqresp/interface.js";

interface IBaseNetwork {
  close(): Promise<void>;
  scrapeMetrics(): Promise<string>;

  // chain updates
  updateStatus(status: phase0.Status): Promise<void>;

  // Peer manager control
  /** Subscribe, search peers, join long-lived attnets */
  prepareBeaconCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void>;
  /** Subscribe, search peers, join long-lived syncnets */
  prepareSyncCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void>;
  hasAttachedSyncCommitteeMember(): Promise<boolean>;
  reStatusPeers(peers: PeerId[]): Promise<void>;
  reportPeer(peer: PeerId, action: PeerAction, actionName: string): Promise<void>;

  // REST API getters
  getConnectedPeers(): Promise<PeerId[]>;
  getConnectedPeerCount(): Promise<number>;
  getNetworkIdentity(): Promise<routes.node.NetworkIdentity>;

  // Gossip control
  subscribeGossipCoreTopics(): Promise<void>;
  unsubscribeGossipCoreTopics(): Promise<void>;
  // isSubscribedToGossipCoreTopics(): Promise<boolean>;

  // Debug
  connectToPeer(peer: PeerId, multiaddr: Multiaddr[]): Promise<void>;
  disconnectPeer(peer: PeerId): Promise<void>;
  dumpPeers(): Promise<routes.lodestar.LodestarNodePeer[]>;
  dumpPeer(peerIdStr: string): Promise<routes.lodestar.LodestarNodePeer | undefined>;
  dumpPeerScoreStats(): Promise<PeerScoreStats>;
  dumpGossipPeerScoreStats(): Promise<PeerScoreStatsDump>;
  dumpDiscv5KadValues(): Promise<string[]>;
  dumpMeshPeers(): Promise<Record<string, string[]>>;
  dumpENR(): Promise<string | undefined>;
}

/**
 * Contains core network functionality (libp2p and dependent modules)
 *
 * All properties/methods should be async to allow for a worker implementation
 */
export interface INetworkCore extends IBaseNetwork {
  gossip: PublisherBeaconNode;
  reqResp: IReqRespBeaconNode;
}
