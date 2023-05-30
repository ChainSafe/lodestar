import {PeerId} from "@libp2p/interface-peer-id";
import {altair} from "@lodestar/types";
import {Encoding} from "@lodestar/reqresp";
import {ClientKind} from "./client.js";

type PeerIdStr = string;

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

/**
 * Make data available to multiple components in the network stack.
 * Due to class dependencies some modules have circular dependencies, like PeerManager - ReqResp.
 * This third party class allows data to be available to both.
 *
 * The pruning and bounding of this class is handled by the PeerManager
 */
export class PeersData {
  readonly connectedPeers = new Map<PeerIdStr, PeerData>();

  getAgentVersion(peerIdStr: string): string {
    return this.connectedPeers.get(peerIdStr)?.agentVersion ?? "NA";
  }

  getPeerKind(peerIdStr: string): ClientKind {
    return this.connectedPeers.get(peerIdStr)?.agentClient ?? ClientKind.Unknown;
  }

  getEncodingPreference(peerIdStr: string): Encoding | null {
    return this.connectedPeers.get(peerIdStr)?.encodingPreference ?? null;
  }

  setEncodingPreference(peerIdStr: string, encoding: Encoding): void {
    const peerData = this.connectedPeers.get(peerIdStr);
    if (peerData) {
      peerData.encodingPreference = encoding;
    }
  }
}
