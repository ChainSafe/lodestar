import type {PeerId} from "@libp2p/interface-peer-id";
import type {Connection} from "@libp2p/interface-connection";
import type {ConnectionManager} from "@libp2p/interface-connection-manager";
import type {Components} from "libp2p/components.js";
import type {DefaultConnectionManager} from "libp2p/connection-manager/index.js";
import type {DefaultDialer} from "libp2p/connection-manager/dialer/index.js";
import type {Libp2p} from "./interface.js";

export function prettyPrintPeerId(peerId: PeerId): string {
  const id = peerId.toString();
  return `${id.substr(0, 2)}...${id.substr(id.length - 6, id.length)}`;
}

/**
 * Get the connections map from a connection manager
 */
// Compat function for type mismatch reasons
export function getConnectionsMap(connectionManager: ConnectionManager): Map<string, Connection[]> {
  return (connectionManager as unknown as DefaultConnectionManager)["connections"] as Map<string, Connection[]>;
}

export function getConnection(connectionManager: ConnectionManager, peerIdStr: string): Connection | undefined {
  return getConnectionsMap(connectionManager).get(peerIdStr)?.[0] ?? undefined;
}

// https://github.com/ChainSafe/js-libp2p-gossipsub/blob/3475242ed254f7647798ab7f36b21909f6cb61da/src/index.ts#L2009
export function isPublishToZeroPeersError(e: Error): boolean {
  return e.message.includes("PublishError.InsufficientPeers");
}

export function getDefaultDialer(libp2p: Libp2p): DefaultDialer {
  return (libp2p as unknown as {components: Components}).components.dialer as DefaultDialer;
}
