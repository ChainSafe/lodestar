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

export function filterByState(peers: LibP2p.Peer[] = [], network: INetwork, state: string[]): LibP2p.Peer[] {
  // by default return all
  if (!state.length) return peers;
  return peers.filter((peer) => {
    const conn = network.getPeerConnection(peer.id);
    if (!state.includes("disconnected") && (!conn || conn.stat.status === "closed")) return false;
    // TODO: not sure how to map "connecting" state
    if (!state.includes("connected") && conn && conn.stat.status === "open") return false;
    if (!state.includes("disconnecting") && conn && conn.stat.status === "closing") return false;
    return true;
  });
}

export function filterByDirection(peers: LibP2p.Peer[] = [], network: INetwork, direction: string[]): LibP2p.Peer[] {
  // by default return all
  if (!direction.length) return peers;
  return peers.filter((peer) => {
    const conn = network.getPeerConnection(peer.id);
    if (!direction.includes("inbound") && conn && conn.stat.direction === "inbound") return false;
    if (!direction.includes("outbound") && conn && conn.stat.direction === "outbound") return false;
    return true;
  });
}
