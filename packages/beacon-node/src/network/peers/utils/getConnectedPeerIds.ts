import LibP2p, {Connection} from "libp2p";
import PeerId from "peer-id";

/**
 * Return peers with at least one connection in status "open"
 */
export function getConnectedPeerIds(libp2p: LibP2p): PeerId[] {
  const peerIds: PeerId[] = [];
  for (const connections of libp2p.connectionManager.connections.values()) {
    const openConnection = connections.find(isConnectionOpen);
    if (openConnection) {
      peerIds.push(openConnection.remotePeer);
    }
  }
  return peerIds;
}

/**
 * Efficiently check if there is at least one peer connected
 */
export function hasSomeConnectedPeer(libp2p: LibP2p): boolean {
  for (const connections of libp2p.connectionManager.connections.values()) {
    if (connections.some(isConnectionOpen)) {
      return true;
    }
  }
  return false;
}

function isConnectionOpen(connection: Connection): boolean {
  return connection.stat.status === "open";
}
