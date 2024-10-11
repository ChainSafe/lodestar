import {PeerId} from "@libp2p/interface";
import {base58btc} from "multiformats/bases/base58";
import {peerIdFromString} from "@libp2p/peer-id";

// Ensure consistent serialization of PeerId to string

/**
 * PeerId serialized with `peerId.toString`
 */
export type PeerIdStr = string;

export {peerIdFromString};

export function peerIdToString(peerId: PeerId): string {
  return base58btc.encode(peerId.toMultihash().bytes).slice(1);
}
