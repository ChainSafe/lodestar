import {routes} from "@lodestar/api";
import {Direction, PeerId} from "@libp2p/interface";

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
    status: null,
    metadata: null,
    agentClient: "",
    lastReceivedMsgUnixTsMs: 0,
    lastStatusUnixTsMs: 0,
    connectedUnixTsMs: 0,
  };
}
