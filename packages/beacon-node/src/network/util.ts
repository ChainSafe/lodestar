import {PeerId} from "@libp2p/interface-peer-id";
import {Connection} from "@libp2p/interface-connection";
import {ConnectionManager} from "@libp2p/interface-connection-manager";
import {DefaultConnectionManager} from "libp2p/connection-manager";

/**
 * Return a fresh PeerId instance
 */
export async function createPeerId(): Promise<PeerId> {
  return await PeerId.create({bits: 256, keyType: "secp256k1"});
}

export function prettyPrintPeerId(peerId: PeerId): string {
  const id = peerId.toString();
  return `${id.substr(0, 2)}...${id.substr(id.length - 6, id.length)}`;
}

/**
 * Get the connections map from a connection manager
 */
// Compat function for type mismatch reasons
export function getConnectionsMap(connectionManager: ConnectionManager): Map<string, Connection[]> {
  return (connectionManager as DefaultConnectionManager)["connections"] as Map<string, Connection[]>;
}

export function getConnection(connectionManager: ConnectionManager, peerIdStr: string): Connection | undefined {
  return getConnectionsMap(connectionManager).get(peerIdStr)?.[0] ?? undefined;
}
