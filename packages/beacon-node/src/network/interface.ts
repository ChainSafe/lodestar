import {Connection} from "@libp2p/interface-connection";
import {Multiaddr} from "@multiformats/multiaddr";
import {PeerId} from "@libp2p/interface-peer-id";
import {Discv5, ENR} from "@chainsafe/discv5";
import {INetworkEventBus} from "./events.js";
import {Eth2Gossipsub} from "./gossip/index.js";
import {MetadataController} from "./metadata.js";
import {PeerAction} from "./peers/index.js";
import {IReqResp} from "./reqresp/index.js";
import {IAttnetsService, ISubnetsService, CommitteeSubscription} from "./subnets/index.js";

export type PeerSearchOptions = {
  supportsProtocols?: string[];
  count?: number;
};

export interface INetwork {
  events: INetworkEventBus;
  reqResp: IReqResp;
  attnetsService: IAttnetsService;
  syncnetsService: ISubnetsService;
  gossip: Eth2Gossipsub;
  discv5?: Discv5;
  metadata: MetadataController;
  /** Our network identity */
  peerId: PeerId;
  localMultiaddrs: Multiaddr[];
  getEnr(): ENR | undefined;
  getConnectionsByPeer(): Map<string, Connection[]>;
  getConnectedPeers(): PeerId[];
  hasSomeConnectedPeer(): boolean;
  /** Subscribe, search peers, join long-lived attnets */
  prepareBeaconCommitteeSubnet(subscriptions: CommitteeSubscription[]): void;
  /** Subscribe, search peers, join long-lived syncnets */
  prepareSyncCommitteeSubnets(subscriptions: CommitteeSubscription[]): void;
  reStatusPeers(peers: PeerId[]): void;
  reportPeer(peer: PeerId, action: PeerAction, actionName: string): void;

  // Gossip handler
  subscribeGossipCoreTopics(): void;
  unsubscribeGossipCoreTopics(): void;
  isSubscribedToGossipCoreTopics(): boolean;

  // Service
  start(): Promise<void>;
  stop(): Promise<void>;
  close(): void;

  // Debug
  connectToPeer(peer: PeerId, multiaddr: Multiaddr[]): Promise<void>;
  disconnectPeer(peer: PeerId): Promise<void>;
  getAgentVersion(peerIdStr: string): string;
}

export type PeerDirection = Connection["stat"]["direction"];
export type PeerStatus = Connection["stat"]["status"];
