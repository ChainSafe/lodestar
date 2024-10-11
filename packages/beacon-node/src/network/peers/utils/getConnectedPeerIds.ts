import {Connection, PeerId} from "@libp2p/interface";
import {Libp2p} from "../../interface.js";
import {getConnectionsMap} from "../../util.js";

/**
 * Return peers with at least one connection in status "open"
 */
export function getConnectedPeerIds(libp2p: Libp2p): PeerId[] {
  const peerIds: PeerId[] = [];
  for (const connections of getConnectionsMap(libp2p).values()) {
    const openConnection = connections.value.find(isConnectionOpen);
    if (openConnection) {
      peerIds.push(openConnection.remotePeer);
    }
  }
  return peerIds;
}

/**
 * Efficiently check if there is at least one peer connected
 */
export function hasSomeConnectedPeer(libp2p: Libp2p): boolean {
  for (const connections of getConnectionsMap(libp2p).values()) {
    if (connections.value.some(isConnectionOpen)) {
      return true;
    }
  }
  return false;
}

function isConnectionOpen(connection: Connection): boolean {
  return connection.status === "open";
}
