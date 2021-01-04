import {NodePeer} from "../../types";
import LibP2p from "libp2p";
import {INetwork} from "../../../network";

export function getPeerState(status: LibP2pConnection["stat"]["status"]): NodePeer["state"] {
  switch (status) {
    case "closed":
      return "disconnected";
    case "closing":
      return "disconnecting";
    case "open":
      return "connected";
    default:
      return "disconnected";
  }
}

export function filterByStateAndDirection(
  peers: LibP2p.Peer[] = [],
  network: INetwork,
  state: string[] = [],
  direction: string[] = []
): LibP2p.Peer[] {
  if (!state.length) return peers;
  return peers.filter((peer) => {
    const conn = network.getPeerConnection(peer.id);
    // by default return all states
    if (state.length) {
      if (!state.includes("disconnected") && (!conn || conn.stat.status === "closed")) return false;
      // TODO: not sure how to map "connecting" state
      if (!state.includes("connected") && conn && conn.stat.status === "open") return false;
      if (!state.includes("disconnecting") && conn && conn.stat.status === "closing") return false;
    }
    // by default return all directions
    if (direction.length) {
      if (!direction.includes("inbound") && conn && conn.stat.direction === "inbound") return false;
      if (!direction.includes("outbound") && conn && conn.stat.direction === "outbound") return false;
    }

    return true;
  });
}
