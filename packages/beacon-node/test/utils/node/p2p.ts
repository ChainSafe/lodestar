import {PeerId} from "@libp2p/interface/peer-id";
import {Direction} from "@libp2p/interface/connection";
import {routes} from "@lodestar/api";

export function lodestarNodePeer(
  peer: PeerId,
  state: routes.node.PeerState,
  direction: Direction | null
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
