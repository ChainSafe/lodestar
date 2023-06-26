import type {PeerId} from "@libp2p/interface-peer-id";
import type {Connection} from "@libp2p/interface-connection";
import type {DefaultConnectionManager} from "libp2p/connection-manager/index.js";
import type {PeerIdStr} from "../util/peerId.js";
import type {Libp2p} from "./interface.js";

export function prettyPrintPeerId(peerId: PeerId): string {
  return prettyPrintPeerIdStr(peerId.toString());
}

export function prettyPrintPeerIdStr(id: PeerIdStr): string {
  return `${id.slice(0, 2)}...${id.slice(id.length - 6, id.length)}`;
}

/**
 * Get the connections map from a connection manager
 */
// Compat function for efficiency reasons
export function getConnectionsMap(libp2p: Libp2p): Map<string, Connection[]> {
  return (libp2p.services.components.connectionManager as DefaultConnectionManager)["connections"] as Map<
    string,
    Connection[]
  >;
}

export function getConnection(libp2p: Libp2p, peerIdStr: string): Connection | undefined {
  return getConnectionsMap(libp2p).get(peerIdStr)?.[0] ?? undefined;
}

// https://github.com/ChainSafe/js-libp2p-gossipsub/blob/3475242ed254f7647798ab7f36b21909f6cb61da/src/index.ts#L2009
export function isPublishToZeroPeersError(e: Error): boolean {
  return e.message.includes("PublishError.InsufficientPeers");
}
