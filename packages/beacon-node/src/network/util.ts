import type {Connection, PeerId} from "@libp2p/interface";
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
export function getConnectionsMap(libp2p: Libp2p): Map<string, {key: PeerId; value: Connection[]}> {
  // biome-ignore lint/complexity/useLiteralKeys: access of private property
  return libp2p.services.components.connectionManager.getConnectionsMap()["map"];
}

export function getConnection(libp2p: Libp2p, peerIdStr: string): Connection | undefined {
  return getConnectionsMap(libp2p).get(peerIdStr)?.value[0] ?? undefined;
}

// https://github.com/libp2p/js-libp2p/blob/f87cba928991736d9646b3e054c367f55cab315c/packages/gossipsub/src/gossipsub.ts#L2076
export function isPublishToZeroPeersError(e: Error): boolean {
  return e.message.includes("PublishError.NoPeersSubscribedToTopic");
}
