import {EventEmitter} from "events";
import {PeerId} from "@libp2p/interface-peer-id";
import StrictEventEmitter from "strict-event-emitter-types";
import {ENR} from "@chainsafe/discv5";
import {BitArray} from "@chainsafe/ssz";
import {ForkName} from "@lodestar/params";
import {allForks, altair, Epoch, phase0} from "@lodestar/types";
import {Encoding, RequestTypedContainer} from "./types.js";

// These interfaces are shared among beacon-node package.
export enum ScoreState {
  /** We are content with the peers performance. We permit connections and messages. */
  Healthy = "Healthy",
  /** The peer should be disconnected. We allow re-connections if the peer is persistent */
  Disconnected = "Disconnected",
  /** The peer is banned. We disallow new connections until it's score has decayed into a tolerable threshold */
  Banned = "Banned",
}

type PeerIdStr = string;

export enum PeerAction {
  /** Immediately ban peer */
  Fatal = "Fatal",
  /**
   * Not malicious action, but it must not be tolerated
   * ~5 occurrences will get the peer banned
   */
  LowToleranceError = "LowToleranceError",
  /**
   * Negative action that can be tolerated only sometimes
   * ~10 occurrences will get the peer banned
   */
  MidToleranceError = "MidToleranceError",
  /**
   * Some error that can be tolerated multiple times
   * ~50 occurrences will get the peer banned
   */
  HighToleranceError = "HighToleranceError",
}

export interface IPeerRpcScoreStore {
  getScore(peer: PeerId): number;
  getScoreState(peer: PeerId): ScoreState;
  applyAction(peer: PeerId, action: PeerAction, actionName: string): void;
  update(): void;
  updateGossipsubScore(peerId: PeerIdStr, newScore: number, ignore: boolean): void;
}

export enum NetworkEvent {
  /** A relevant peer has connected or has been re-STATUS'd */
  peerConnected = "peer-manager.peer-connected",
  peerDisconnected = "peer-manager.peer-disconnected",
  gossipStart = "gossip.start",
  gossipStop = "gossip.stop",
  gossipHeartbeat = "gossipsub.heartbeat",
  reqRespRequest = "req-resp.request",
  unknownBlockParent = "unknownBlockParent",
}

export type NetworkEvents = {
  [NetworkEvent.peerConnected]: (peer: PeerId, status: phase0.Status) => void;
  [NetworkEvent.peerDisconnected]: (peer: PeerId) => void;
  [NetworkEvent.reqRespRequest]: (request: RequestTypedContainer, peer: PeerId) => void;
  [NetworkEvent.unknownBlockParent]: (signedBlock: allForks.SignedBeaconBlock, peerIdStr: string) => void;
};

export type INetworkEventBus = StrictEventEmitter<EventEmitter, NetworkEvents>;

export enum RelevantPeerStatus {
  Unknown = "unknown",
  relevant = "relevant",
  irrelevant = "irrelevant",
}

export type PeerData = {
  lastReceivedMsgUnixTsMs: number;
  lastStatusUnixTsMs: number;
  connectedUnixTsMs: number;
  relevantStatus: RelevantPeerStatus;
  direction: "inbound" | "outbound";
  peerId: PeerId;
  metadata: altair.Metadata | null;
  agentVersion: string | null;
  agentClient: ClientKind | null;
  encodingPreference: Encoding | null;
};

export enum ClientKind {
  Lighthouse = "Lighthouse",
  Nimbus = "Nimbus",
  Teku = "Teku",
  Prysm = "Prysm",
  Lodestar = "Lodestar",
  Unknown = "Unknown",
}

export interface PeersData {
  getAgentVersion(peerIdStr: string): string;
  getPeerKind(peerIdStr: string): ClientKind;
  getEncodingPreference(peerIdStr: string): Encoding | null;
  setEncodingPreference(peerIdStr: string, encoding: Encoding): void;
}

export interface MetadataController {
  seqNumber: bigint;
  syncnets: BitArray;
  attnets: BitArray;
  json: altair.Metadata;
  start(enr: ENR | undefined, currentFork: ForkName): void;
  updateEth2Field(epoch: Epoch): void;
}
