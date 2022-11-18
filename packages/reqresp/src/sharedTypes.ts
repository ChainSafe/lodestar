import {Encoding} from "./types.js";

// These interfaces are shared among beacon-node package.
export enum ScoreState {
  /** We are content with the peers performance. We permit connections and messages. */
  Healthy = "Healthy",
  /** The peer should be disconnected. We allow re-connections if the peer is persistent */
  Disconnected = "Disconnected",
  /** The peer is banned. We disallow new connections until it's score has decayed into a tolerable threshold */
  Banned = "Banned",
}

export enum RelevantPeerStatus {
  Unknown = "unknown",
  relevant = "relevant",
  irrelevant = "irrelevant",
}

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
