import {PeerId} from "@libp2p/interface/peer-id";
import {NetworkCoreMetrics} from "../../core/metrics.js";

export type PeerIdStr = string;

export type PeerRpcScoreOpts = {
  disablePeerScoring?: boolean;
};

export interface IPeerRpcScoreStore {
  getScore(peer: PeerId): number;
  getGossipScore(peer: PeerId): number;
  getScoreState(peer: PeerId): ScoreState;
  dumpPeerScoreStats(): PeerScoreStats;
  applyAction(peer: PeerId, action: PeerAction, actionName: string): void;
  update(): void;
  updateGossipsubScore(peerId: PeerIdStr, newScore: number, ignore: boolean): void;
}

export interface IPeerScore {
  getScore(): number;
  getGossipScore(): number;
  add(scoreDelta: number): void;
  update(): number;
  updateGossipsubScore(newScore: number, ignore: boolean): void;
  getStat(): PeerScoreStat;
}

export enum ScoreState {
  /** We are content with the peers performance. We permit connections and messages. */
  Healthy = "Healthy",
  /** The peer should be disconnected. We allow re-connections if the peer is persistent */
  Disconnected = "Disconnected",
  /** The peer is banned. We disallow new connections until it's score has decayed into a tolerable threshold */
  Banned = "Banned",
}

export type PeerRpcScoreStoreModules = {
  metrics: NetworkCoreMetrics | null;
};

export type PeerScoreStats = ({peerId: PeerIdStr} & PeerScoreStat)[];

export type PeerScoreStat = {
  lodestarScore: number;
  gossipScore: number;
  ignoreNegativeGossipScore: boolean;
  score: number;
  lastUpdate: number;
};

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
