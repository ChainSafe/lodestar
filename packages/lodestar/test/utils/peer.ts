import PeerId from "peer-id";
import LibP2p from "libp2p";
import Peer = LibP2p.Peer;

export function generatePeer(id: PeerId): Peer {
  return {
    id,
    addresses: [],
    metadata: new Map(),
    protocols: [],
  };
}
