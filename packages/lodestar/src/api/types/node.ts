import {phase0} from "@chainsafe/lodestar-types";
import {PeerDirection, PeerState} from "../../network";

export type NodeIdentity = {
  peerId: string;
  enr: string;
  p2pAddresses: string[];
  discoveryAddresses: string[];
  metadata: phase0.Metadata;
};

export type NodePeer = {
  peerId: string;
  enr: string;
  lastSeenP2pAddress: string;
  state: PeerState;
  // the spec does not specify direction for a disconnected peer, lodestar uses null in that case
  direction: PeerDirection | null;
};
