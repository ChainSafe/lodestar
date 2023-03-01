import {Connection} from "@libp2p/interface-connection";
import {routes} from "@lodestar/api";
import {PeerStatus} from "../../../network/index.js";

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
export function getRelevantConnection(connections: Connection[]): Connection | null {
  const byStatus = new Map<PeerStatus, Connection>();
  for (const conn of connections) {
    if (conn.stat.status === "OPEN") return conn;
    if (!byStatus.has(conn.stat.status)) byStatus.set(conn.stat.status, conn);
  }

  return byStatus.get("OPEN") || byStatus.get("CLOSING") || byStatus.get("CLOSED") || null;
}

/**
 * Map libp2p connection status to the API's peer state notation
 * @param status
 */
function getPeerState(status: PeerStatus): routes.node.PeerState {
  switch (status) {
    case "OPEN":
      return "connected";
    case "CLOSING":
      return "disconnecting";
    case "CLOSED":
    default:
      return "disconnected";
  }
}
