import {PeerId} from "@libp2p/interface-peer-id";
import {peerIdFromString} from "@libp2p/peer-id";

// Ensure consistent serialization of PeerId to string

/**
 * PeerId serialized with `peerId.toString`
 */
export type PeerIdStr = string;

export {peerIdFromString};

export function peerIdToString(peerId: PeerId): string {
  return peerId.toString();
}
