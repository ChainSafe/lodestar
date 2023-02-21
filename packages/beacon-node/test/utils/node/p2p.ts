import {PeerId} from "@libp2p/interface-peer-id";
import {routes} from "@lodestar/api";
import {PeerDirection} from "../../../src/network/index.js";

export function lodestarNodePeer(
  peer: PeerId,
  state: routes.node.PeerState,
  direction: PeerDirection | null
): routes.lodestar.LodestarNodePeer {
  return {
    peerId: peer.toString(),
    state,
    direction,
    enr: "",
    lastSeenP2pAddress: "",
    agentVersion: "",
  };
}
