import PeerId from "peer-id";
import {Multiaddr} from "multiaddr";
import {ATTESTATION_SUBNET_COUNT, SYNC_COMMITTEE_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {Network} from "../../src/network";
import {NodejsNode} from "../../src/network/nodejs";
import {createPeerId} from "../../src/network";
import {Libp2pEvent} from "../../src/constants";

export async function createNode(multiaddr: string, inPeerId?: PeerId): Promise<NodejsNode> {
  const peerId = inPeerId || (await createPeerId());
  return new NodejsNode({
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
    network["libp2p"].connectionManager.on(Libp2pEvent.peerConnect, resolve)
  );
}

export function onPeerDisconnect(network: Network): Promise<void> {
  return new Promise<void>((resolve) =>
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    network["libp2p"].connectionManager.on(Libp2pEvent.peerDisconnect, resolve)
  );
}

/**
 * Generate valid filled attnets BitVector
 */
export function getAttnets(subnetIds: number[] = []): boolean[] {
  const attnets = new Array<boolean>(ATTESTATION_SUBNET_COUNT).fill(false);
  for (const subnetId of subnetIds) {
    attnets[subnetId] = true;
  }
  return attnets;
}

/**
 * Generate valid filled syncnets BitVector
 */
export function getSyncnets(subnetIds: number[] = []): boolean[] {
  const attnets = new Array<boolean>(SYNC_COMMITTEE_SUBNET_COUNT).fill(false);
  for (const subnetId of subnetIds) {
    attnets[subnetId] = true;
  }
  return attnets;
}
