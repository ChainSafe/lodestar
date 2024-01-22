import {Direction, PeerId} from "@libp2p/interface";
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
