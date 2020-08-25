import PeerId from "peer-id";
import LibP2p from "libp2p";
import PeerType = LibP2p.PeerType;

export function generatePeer(id: PeerId): PeerType {
  return {
    id,
    addresses: [],
    metadata: new Map(),
    protocols: [],
  };
}
