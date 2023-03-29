import {Libp2p as ILibp2p} from "libp2p";
import {Connection} from "@libp2p/interface-connection";
import {Registrar} from "@libp2p/interface-registrar";
import {PeerId} from "@libp2p/interface-peer-id";
import {ConnectionManager} from "@libp2p/interface-connection-manager";
import {Multiaddr} from "@multiformats/multiaddr";
import {phase0} from "@lodestar/types";
import {BlockInput} from "../chain/blocks/types.js";
import {INetworkEventBus} from "./events.js";
import {GossipType, PublisherBeaconNode} from "./gossip/index.js";
import {PendingGossipsubMessage} from "./processor/types.js";
import {INetworkCore} from "./core/types.js";
import {IReqRespBeaconNode} from "./reqresp/interface.js";

export type PeerSearchOptions = {
  supportsProtocols?: string[];
  count?: number;
};

export interface INetwork
  extends Omit<INetworkCore, "gossip" | "reqResp" | "updateStatus" | "getConnectedPeers" | "getConnectedPeerCount"> {
  /** Our network identity */
  peerId: PeerId;
  localMultiaddrs: Multiaddr[];

  events: INetworkEventBus;
  gossip: PublisherBeaconNode;
  reqResp: IReqRespBeaconNode;

  getConnectedPeers(): PeerId[];
  getConnectedPeerCount(): number;
  isSubscribedToGossipCoreTopics(): boolean;

  // TODO move these reqresp methods into their respective module
  beaconBlocksMaybeBlobsByRange(peerId: PeerId, request: phase0.BeaconBlocksByRangeRequest): Promise<BlockInput[]>;
  beaconBlocksMaybeBlobsByRoot(peerId: PeerId, request: phase0.BeaconBlocksByRootRequest): Promise<BlockInput[]>;

  dumpGossipQueue(gossipType: GossipType): Promise<PendingGossipsubMessage[]>;
}

export type PeerDirection = Connection["stat"]["direction"];
export type PeerStatus = Connection["stat"]["status"];

export type Libp2p = ILibp2p & {connectionManager: ConnectionManager; registrar: Registrar};
