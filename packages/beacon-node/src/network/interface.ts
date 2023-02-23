import {Libp2p as ILibp2p} from "libp2p";
import {Connection} from "@libp2p/interface-connection";
import {Registrar} from "@libp2p/interface-registrar";
import {Multiaddr} from "@multiformats/multiaddr";
import {PeerId} from "@libp2p/interface-peer-id";
import {ConnectionManager} from "@libp2p/interface-connection-manager";
import {SignableENR} from "@chainsafe/discv5";
import {altair, phase0} from "@lodestar/types";
import {PeerScoreStatsDump} from "@chainsafe/libp2p-gossipsub/score";
import {routes} from "@lodestar/api";
import {BlockInput} from "../chain/blocks/types.js";
import {INetworkEventBus} from "./events.js";
import {GossipBeaconNode} from "./gossip/index.js";
import {PeerAction, PeerScoreStats} from "./peers/index.js";
import {IReqRespBeaconNode} from "./reqresp/ReqRespBeaconNode.js";
import {CommitteeSubscription} from "./subnets/index.js";

export type PeerSearchOptions = {
  supportsProtocols?: string[];
  count?: number;
};

export interface INetwork {
  /** Our network identity */
  peerId: PeerId;
  localMultiaddrs: Multiaddr[];

  events: INetworkEventBus;
  reqResp: IReqRespBeaconNode;
  gossip: GossipBeaconNode;

  getEnr(): Promise<SignableENR | undefined>;
  getMetadata(): Promise<altair.Metadata>;
  getConnectedPeers(): PeerId[];
  getConnectedPeerCount(): number;

  publishBeaconBlockMaybeBlobs(signedBlock: BlockInput): Promise<void>;
  beaconBlocksMaybeBlobsByRange(peerId: PeerId, request: phase0.BeaconBlocksByRangeRequest): Promise<BlockInput[]>;
  beaconBlocksMaybeBlobsByRoot(peerId: PeerId, request: phase0.BeaconBlocksByRootRequest): Promise<BlockInput[]>;

  /** Subscribe, search peers, join long-lived attnets */
  prepareBeaconCommitteeSubnet(subscriptions: CommitteeSubscription[]): Promise<void>;
  /** Subscribe, search peers, join long-lived syncnets */
  prepareSyncCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void>;
  reStatusPeers(peers: PeerId[]): Promise<void>;
  reportPeer(peer: PeerId, action: PeerAction, actionName: string): Promise<void>;

  // Gossip handler
  subscribeGossipCoreTopics(): Promise<void>;
  unsubscribeGossipCoreTopics(): Promise<void>;
  isSubscribedToGossipCoreTopics(): boolean;

  // Service
  metrics(): Promise<string>;
  close(): Promise<void>;

  // Debug
  connectToPeer(peer: PeerId, multiaddr: Multiaddr[]): Promise<void>;
  disconnectPeer(peer: PeerId): Promise<void>;
  dumpPeers(): Promise<routes.lodestar.LodestarNodePeer[]>;
  dumpPeer(peerIdStr: string): Promise<routes.lodestar.LodestarNodePeer | undefined>;
  dumpPeerScoreStats(): Promise<PeerScoreStats>;
  dumpGossipPeerScoreStats(): Promise<PeerScoreStatsDump>;
  dumpGossipQueueItems(gossipType: string): Promise<routes.lodestar.GossipQueueItem[]>;
  dumpDiscv5KadValues(): Promise<string[]>;
}

export type PeerDirection = Connection["stat"]["direction"];
export type PeerStatus = Connection["stat"]["status"];

export type Libp2p = ILibp2p & {connectionManager: ConnectionManager; registrar: Registrar};
