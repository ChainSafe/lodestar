/**
 * @module network/libp2p
 */
import PeerId from "peer-id";
import PeerInfo from "peer-info";
import promisify from "promisify-es6";

/**
 * Return a fresh PeerInfo instance
 */
export async function createPeerInfo(peerId: PeerId): Promise<PeerInfo> {
  return await promisify(PeerInfo.create)(peerId);
}

/**
 * Return a fresh PeerId instance
 */
export async function createPeerId(): Promise<PeerId> {
  return await promisify(PeerId.create)({bits: 2048});
}

export async function initializePeerInfo(peerId: PeerId, multiaddrs: string[]): Promise<PeerInfo> {
  const peerInfo = await createPeerInfo(peerId);
  multiaddrs.forEach((ma) => peerInfo.multiaddrs.add(ma));
  return peerInfo;
}
