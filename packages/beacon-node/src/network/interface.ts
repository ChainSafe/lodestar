import {Libp2p as ILibp2p} from "libp2p";
import {Connection} from "@libp2p/interface-connection";
import {Registrar} from "@libp2p/interface-registrar";
import {Multiaddr} from "@multiformats/multiaddr";
import {PeerId} from "@libp2p/interface-peer-id";
import {ConnectionManager} from "@libp2p/interface-connection-manager";
import {SignableENR} from "@chainsafe/discv5";
import {phase0} from "@lodestar/types";
import {BlockInput} from "../chain/blocks/types.js";
import {INetworkEventBus} from "./events.js";
import {Eth2Gossipsub} from "./gossip/index.js";
import {MetadataController} from "./metadata.js";
import {IPeerRpcScoreStore, PeerAction} from "./peers/index.js";
import {IReqRespBeaconNode} from "./reqresp/ReqRespBeaconNode.js";
import {IAttnetsService, ISubnetsService, CommitteeSubscription} from "./subnets/index.js";
import {Discv5Worker} from "./discv5/index.js";

export type PeerSearchOptions = {
  supportsProtocols?: string[];
  count?: number;
};

export interface INetwork {
  events: INetworkEventBus;
  reqResp: IReqRespBeaconNode;
  attnetsService: IAttnetsService;
  syncnetsService: ISubnetsService;
  gossip: Eth2Gossipsub;
  discv5(): Discv5Worker | undefined;
  metadata: MetadataController;
  peerRpcScores: IPeerRpcScoreStore;
  /** Our network identity */
  peerId: PeerId;
  localMultiaddrs: Multiaddr[];
  getEnr(): Promise<SignableENR | undefined>;
  getConnectionsByPeer(): Map<string, Connection[]>;
  getConnectedPeers(): PeerId[];
  hasSomeConnectedPeer(): boolean;

  publishBeaconBlockMaybeBlobs(signedBlock: BlockInput): Promise<void>;
  beaconBlocksMaybeBlobsByRange(peerId: PeerId, request: phase0.BeaconBlocksByRangeRequest): Promise<BlockInput[]>;
  beaconBlocksMaybeBlobsByRoot(peerId: PeerId, request: phase0.BeaconBlocksByRootRequest): Promise<BlockInput[]>;

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

export type Libp2p = ILibp2p & {connectionManager: ConnectionManager; registrar: Registrar};
