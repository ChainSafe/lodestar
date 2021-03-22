import PeerId from "peer-id";

/**
 * Return peers with at least one connection in status "open"
 */
export function getConnectedPeerIds(libp2p: LibP2p): PeerId[] {
  const peerIds: PeerId[] = [];
  for (const connections of libp2p.connectionManager.connections.values()) {
    const openConnection = connections.find((connection) => connection.stat.status === "open");
    if (openConnection) {
      peerIds.push(openConnection.remotePeer);
    }
  }
  return peerIds;
}
