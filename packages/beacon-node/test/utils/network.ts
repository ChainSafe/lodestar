import {BitArray} from "@chainsafe/ssz";
import {PrivateKey} from "@libp2p/interface";
import {generateKeyPair} from "@libp2p/crypto/keys";
import {ATTESTATION_SUBNET_COUNT, SYNC_COMMITTEE_SUBNET_COUNT} from "@lodestar/params";
import {INetwork, Network, NetworkEvent} from "../../src/network/index.js";
import {Libp2p} from "../../src/network/interface.js";
import {createNodeJsLibp2p} from "../../src/network/libp2p/index.js";
import {NetworkOptions, defaultNetworkOptions} from "../../src/network/options.js";
import {PeerIdStr} from "../../src/util/peerId.js";

export async function createNode(multiaddr: string, privateKey?: PrivateKey): Promise<Libp2p> {
  return createNodeJsLibp2p(privateKey ?? (await generateKeyPair("secp256k1")), {localMultiaddrs: [multiaddr]});
}

export async function createNetworkModules(
  multiaddr: string,
  privateKey?: PrivateKey,
  opts?: Partial<NetworkOptions>
): Promise<{opts: NetworkOptions; privateKey: PrivateKey}> {
  return {
    privateKey: privateKey ?? (await generateKeyPair("secp256k1")),
    opts: {...defaultNetworkOptions, ...opts, localMultiaddrs: [multiaddr]},
  };
}

export async function getPeerIdOf(net: INetwork): Promise<PeerIdStr> {
  return (await net.getNetworkIdentity()).peerId;
}

/**
 * TEMP: Only request required props from INetwork do to this type isse
 */
type INetworkDebug = Pick<INetwork, "connectToPeer" | "disconnectPeer" | "getNetworkIdentity">;

// Helpers to manipulate network's libp2p instance for testing only

export async function connect(netDial: INetworkDebug, netServer: INetworkDebug): Promise<void> {
  const netServerId = await netServer.getNetworkIdentity();
  await netDial.connectToPeer(netServerId.peerId, netServerId.p2pAddresses);
}

export async function disconnect(network: INetworkDebug, peer: string): Promise<void> {
  await network.disconnectPeer(peer);
}

export function onPeerConnect(network: Network): Promise<void> {
  return new Promise<void>((resolve) => network.events.on(NetworkEvent.peerConnected, () => resolve()));
}

export function onPeerDisconnect(network: Network): Promise<void> {
  return new Promise<void>((resolve) => network.events.on(NetworkEvent.peerDisconnected, () => resolve()));
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
