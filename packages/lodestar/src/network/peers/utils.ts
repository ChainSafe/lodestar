import {IPeerMetadataStore} from "./interface";
import PeerId from "peer-id";
import {ATTESTATION_SUBNET_COUNT} from "../../constants";
import {INetwork} from "../interface";
import {ILogger} from "@chainsafe/lodestar-utils";
import {getSyncProtocols} from "../util";
import {notNullish} from "../../util/notNullish";

export function getPeersWithSubnet(peers: PeerId[], peerMetadata: IPeerMetadataStore, subnetStr: string): PeerId[] {
  if (!new RegExp("^\\d+$").test(subnetStr)) {
    throw new Error(`Invalid subnet ${subnetStr}`);
  }
  const subnet = parseInt(subnetStr);
  if (subnet < 0 || subnet >= ATTESTATION_SUBNET_COUNT) {
    throw new Error(`Invalid subnet ${subnetStr}`);
  }
  return peers.filter((peer) => {
    const meta = peerMetadata.getMetadata(peer);
    //remove if no metadata or not in subnet
    return !(!meta || !meta.attnets[subnet]);
  });
}

export async function handlePeerMetadataSequence(
  network: INetwork,
  logger: ILogger,
  peer: PeerId,
  metadataSeq: BigInt | null
): Promise<void> {
  const latestMetadata = network.peerMetadata.getMetadata(peer);
  if (notNullish(metadataSeq) && (!latestMetadata || latestMetadata.seqNumber < metadataSeq)) {
    try {
      logger.verbose("Getting peer metadata", {peer: peer.toB58String()});
      const metadata = await network.reqResp.metadata(peer);
      network.peerMetadata.setMetadata(peer, metadata);
    } catch (e) {
      logger.verbose("Cannot get peer metadata", {peer: peer.toB58String(), e: e.message});
    }
  } else {
    logger.debug("Peer latest metadata already known", {
      peer: peer.toB58String(),
      seq: latestMetadata?.seqNumber.toString() ?? "unknown",
    });
  }
}

/**
 * Find subnets that we don't have at least 1 connected peer.
 */
export function findMissingSubnets(network: INetwork): number[] {
  const peers = network.getPeers({connected: true}).map((peer) => peer.id);
  const attNets = peers
    .map((peer) => network.peerMetadata.getMetadata(peer))
    .filter((metadata) => !!metadata)
    .map((metadata) => {
      return metadata ? metadata.attnets : [];
    });
  const missingSubnets: number[] = [];
  for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
    if (!attNets.some((attNet) => attNet[subnet])) {
      missingSubnets.push(subnet);
    }
  }
  return missingSubnets;
}

/**
 * If we're too close to maxPeer, we may want to disconnect some peers
 * before connecting to new peers with missing subnets.
 * @param network
 * @param newPeer number of peers with new subnets to connect to
 * @param maxPeer max peer provided as option
 * @param reps our reputation store
 * @param retainRatio: 0 to 1, the ratio to consider disconnecting peers, 90% by default.
 */
export function selectPeersToDisconnect(
  network: INetwork,
  newPeer: number,
  maxPeer: number,
  retainRatio = 0.9
): PeerId[] {
  // TODO: prune useless peers
  // peer that timeouts, that doesn't support required protocols (we still keep those as
  // they might be useful to gossip) or that have bad gossip score later on
  const peers = network.getPeers({connected: true}).map((peer) => peer.id);
  // only disconnect peers if we have >= 90% connected peers
  if (peers.length < maxPeer * retainRatio) return [];
  const numDisconnect = peers.length + newPeer - maxPeer;
  if (numDisconnect <= 0) return [];
  // should not disconnect important peers
  const importantPeers = getImportantPeers(peers, network.peerMetadata);
  const candidatePeers = peers.filter((peer) => !importantPeers.has(peer));
  // worse peer on top
  const sortedPeers = candidatePeers.sort((peer1, peer2) => {
    const peer1Meta = network.peerMetadata.getMetadata(peer1);
    const peer2Meta = network.peerMetadata.getMetadata(peer2);
    const syncPeers = network.getPeers({connected: true, supportsProtocols: getSyncProtocols()}).map((peer) => peer.id);
    if (syncPeers.includes(peer1) && !syncPeers.includes(peer2)) return 1;
    if (!syncPeers.includes(peer1) && syncPeers.includes(peer2)) return -1;
    if (!peer1Meta) return -1;
    if (!peer2Meta) return 1;
    let numSubnet1 = 0;
    let numSubnet2 = 0;
    for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
      if (peer1Meta.attnets[subnet]) numSubnet1++;
      if (peer2Meta.attnets[subnet]) numSubnet2++;
    }
    return numSubnet1 - numSubnet2;
  });
  return sortedPeers.slice(0, numDisconnect);
}

/**
 * Peers that should not be disconnected because they are the only connected to a certain subnet.
 * @param peers
 * @param peerMetadata
 */
export function getImportantPeers(peers: PeerId[], peerMetadata: IPeerMetadataStore): Set<PeerId> {
  const importantPeers = new Set<PeerId>();
  for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
    let count = 0;
    let candidatePeer: PeerId | null = null;
    peers.forEach((peer) => {
      const latestMetadata = peerMetadata.getMetadata(peer);
      if (latestMetadata && latestMetadata.attnets[subnet]) {
        candidatePeer = peer;
        count++;
      }
    });
    if (count === 1) importantPeers.add(candidatePeer!);
  }
  return importantPeers;
}
