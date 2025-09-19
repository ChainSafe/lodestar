import {Connection, StreamStatus} from "@libp2p/interface";
import {routes} from "@lodestar/api";

/**
 * Format a list of connections from libp2p connections manager into the API's format NodePeer
 */
export function formatNodePeer(peerIdStr: string, connections: Connection[]): routes.node.NodePeer {
  const conn = getRelevantConnection(connections);

  return {
    peerId: conn ? conn.remotePeer.toString() : peerIdStr,
    // TODO: figure out how to get enr of peer
    enr: "",
    lastSeenP2pAddress: conn ? conn.remoteAddr.toString() : "",
    direction: conn ? (conn.direction as routes.node.PeerDirection) : null,
    state: conn ? getPeerState(conn.status) : "disconnected",
  };
}

/**
 * From a list of connections, get the most relevant of a peer
 * - The first open connection if any
 * - Otherwise, the first closing connection
 * - Otherwise, the first closed connection
 */
export function getRelevantConnection(connections: Connection[]): Connection | null {
  const byStatus = new Map<StreamStatus, Connection>();
  for (const conn of connections) {
    if (conn.status === "open") return conn;
    if (!byStatus.has(conn.status)) byStatus.set(conn.status, conn);
  }

  return byStatus.get("open") || byStatus.get("closing") || byStatus.get("closed") || null;
}

/**
 * Map libp2p connection status to the API's peer state notation
 * @param status
 */
function getPeerState(status: StreamStatus): routes.node.PeerState {
  switch (status) {
    case "open":
      return "connected";
    case "closing":
      return "disconnecting";
    case "closed":
      return "disconnected";
    default:
      return "disconnected";
  }
}
