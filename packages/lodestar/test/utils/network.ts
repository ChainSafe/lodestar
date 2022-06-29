import {PeerId} from "@libp2p/interface-peer-id";
import {Multiaddr} from "@multiformats/multiaddr";
import {Libp2p} from "libp2p";
import {createSecp256k1PeerId} from "@libp2p/peer-id-factory";
import {ATTESTATION_SUBNET_COUNT, SYNC_COMMITTEE_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {BitArray} from "@chainsafe/ssz";
import {Network} from "../../src/network/index.js";
import {createNodejsLibp2p} from "../../src/network/nodejs/index.js";
import {Libp2pEvent} from "../../src/constants/index.js";

export async function createNode(multiaddr: string, inPeerId?: PeerId): Promise<Libp2p> {
  const peerId = inPeerId || (await createSecp256k1PeerId());
  return createNodejsLibp2p({
    peerId,
    addresses: {listen: [multiaddr]},
  });
}

// Helpers to manipulate network's libp2p instance for testing only

export async function connect(network: Network, peer: PeerId, multiaddr: Multiaddr[]): Promise<void> {
  await network.connectToPeer(peer, multiaddr);
}

export async function disconnect(network: Network, peer: PeerId): Promise<void> {
  await network.disconnectPeer(peer);
}

export function onPeerConnect(network: Network): Promise<void> {
  return new Promise<void>((resolve) =>
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    network["libp2p"].connectionManager.addEventListener(Libp2pEvent.peerConnect, () => resolve())
  );
}

export function onPeerDisconnect(network: Network): Promise<void> {
  return new Promise<void>((resolve) =>
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    network["libp2p"].connectionManager.addEventListener(Libp2pEvent.peerDisconnect, () => resolve())
  );
}

/**
 * Generate valid filled attnets BitVector
 */
export function getAttnets(subnetIds: number[] = []): BitArray {
  const attnets = BitArray.fromBitLen(ATTESTATION_SUBNET_COUNT);
  for (const subnetId of subnetIds) {
    attnets.set(subnetId, true);
  }
  return attnets;
}

/**
 * Generate valid filled syncnets BitVector
 */
export function getSyncnets(subnetIds: number[] = []): BitArray {
  const syncnets = BitArray.fromBitLen(SYNC_COMMITTEE_SUBNET_COUNT);
  for (const subnetId of subnetIds) {
    syncnets.set(subnetId, true);
  }
  return syncnets;
}
