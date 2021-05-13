/**
 * @module network
 */
import {Connection} from "libp2p";
import {ENR} from "@chainsafe/discv5/lib";
import Multiaddr from "multiaddr";
import PeerId from "peer-id";
import {INetworkEventBus} from "./events";
import {Eth2Gossipsub} from "./gossip";
import {MetadataController} from "./metadata";
import {IPeerRpcScoreStore, IPeerMetadataStore} from "./peers";
import {IReqResp} from "./reqresp";
import {ISubnetsService, CommitteeSubscription} from "./subnetsService";

export type PeerSearchOptions = {
  supportsProtocols?: string[];
  count?: number;
};

export interface INetwork {
  events: INetworkEventBus;
  reqResp: IReqResp;
  attnetsService: ISubnetsService;
  syncnetsService: ISubnetsService;
  gossip: Eth2Gossipsub;
  metadata: MetadataController;
  peerRpcScores: IPeerRpcScoreStore;
  peerMetadata: IPeerMetadataStore;
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

  // Gossip handler
  subscribeGossipCoreTopics(): void;
  unsubscribeGossipCoreTopics(): void;
  isSubscribedToGossipCoreTopics(): boolean;

  // Service
  start(): Promise<void>;
  stop(): Promise<void>;
}

export type PeerDirection = Connection["stat"]["direction"];
export type PeerStatus = Connection["stat"]["status"];
export type PeerState = "disconnected" | "connecting" | "connected" | "disconnecting";
