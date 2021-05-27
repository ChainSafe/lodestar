import {routes} from "@chainsafe/lodestar-api";
import {Connection} from "libp2p";
import {PeerStatus} from "../../../network";

/**
 * Format a list of connections from libp2p connections manager into the API's format NodePeer
 */
export function formatNodePeer(peerIdStr: string, connections: Connection[]): routes.node.NodePeer {
  const conn = getRevelantConnection(connections);

  return {
    peerId: conn ? conn.remotePeer.toB58String() : peerIdStr,
    // TODO: figure out how to get enr of peer
    enr: "",
    lastSeenP2pAddress: conn ? conn.remoteAddr.toString() : "",
    direction: conn ? (conn.stat.direction as routes.node.PeerDirection) : null,
    state: conn ? getPeerState(conn.stat.status) : "disconnected",
  };
}

/**
 * From a list of connections, get the most relevant of a peer
 * - The first open connection if any
 * - Otherwise, the first closing connection
 * - Otherwise, the first closed connection
 */
function getRevelantConnection(connections: Connection[]): Connection | null {
  const byStatus = new Map<PeerStatus, Connection>();
  for (const conn of connections) {
    if (conn.stat.status === "open") return conn;
    if (!byStatus.has(conn.stat.status)) byStatus.set(conn.stat.status, conn);
  }

  return byStatus.get("open") || byStatus.get("closing") || byStatus.get("closed") || null;
}

/**
 * Map libp2p connection status to the API's peer state notation
 * @param status
 */
function getPeerState(status: PeerStatus): routes.node.PeerState {
  switch (status) {
    case "open":
      return "connected";
    case "closing":
      return "disconnecting";
    case "closed":
    default:
      return "disconnected";
  }
}
