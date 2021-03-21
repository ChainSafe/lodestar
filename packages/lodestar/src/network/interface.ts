/**
 * @module network
 */
import {ENR} from "@chainsafe/discv5/lib";
import Multiaddr from "multiaddr";
import PeerId from "peer-id";
import {INetworkEventBus} from "./events";
import {Eth2Gossipsub} from "./gossip";
import {MetadataController} from "./metadata";
import {RequestedSubnet, IPeerRpcScoreStore, IPeerMetadataStore} from "./peers";
import {IReqResp} from "./reqresp";

export type PeerSearchOptions = {
  supportsProtocols?: string[];
  count?: number;
};

export interface INetwork {
  events: INetworkEventBus;
  reqResp: IReqResp;
  gossip: Eth2Gossipsub;
  metadata: MetadataController;
  peerRpcScores: IPeerRpcScoreStore;
  peerMetadata: IPeerMetadataStore;
  /** Our network identity */
  peerId: PeerId;
  localMultiaddrs: Multiaddr[];
  getEnr(): ENR | undefined;
  getConnectionsByPeer(): Map<string, LibP2pConnection[]>;
  getConnectedPeers(): PeerId[];
  /** Search peers joining subnets */
  requestAttSubnets(requestedSubnets: RequestedSubnet[]): void;
  reStatusPeers(peers: PeerId[]): void;
  // Service
  start(): Promise<void>;
  stop(): Promise<void>;
}

export type PeerDirection = LibP2pConnection["stat"]["direction"];
export type PeerStatus = LibP2pConnection["stat"]["status"];
export type PeerState = "disconnected" | "connecting" | "connected" | "disconnecting";
