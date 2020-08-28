import {IReputationStore} from "../IReputation";
import {Metadata, ATTESTATION_SUBNET_COUNT} from "@chainsafe/lodestar-types";
import PeerId from "peer-id";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IReqResp, INetwork, getSyncProtocols} from "../../network";

export async function handlePeerMetadataSequence(
  reps: IReputationStore,
  reqResp: IReqResp,
  logger: ILogger,
  peer: PeerId,
  peerSeq: BigInt | null
): Promise<void> {
  const latestMetadata = reps.getFromPeerId(peer).latestMetadata;
  if (peerSeq !== null && (!latestMetadata || latestMetadata.seqNumber < peerSeq)) {
    try {
      logger.verbose("Get and update metadata for peer " + peer.toB58String());
      const metadata = await reqResp.metadata(peer);
      updateMetadata(reps, peer.toB58String(), metadata);
    } catch (e) {
      logger.warn("Cannot get metadata for peer " + peer.toB58String());
    }
  }
}

/**
 * Update new metadata to reputation store.
 */
export function updateMetadata(reps: IReputationStore, peerId: string, newMetadata: Metadata | null): void {
  const oldMetadata = reps.get(peerId).latestMetadata;
  if (!oldMetadata) {
    reps.get(peerId).latestMetadata = newMetadata;
    return;
  }
  if (!newMetadata) return;
  if (oldMetadata.seqNumber < newMetadata.seqNumber) reps.get(peerId).latestMetadata = newMetadata;
}

/**
 * Find subnets that we don't have at least 1 connected peer.
 */
export function findMissingSubnets(reps: IReputationStore, network: INetwork): number[] {
  const peers = network.getPeers({connected: true}).map((peer) => peer.id);
  const attNets = peers
    .map((peer) => reps.getFromPeerId(peer).latestMetadata)
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
 * @param peers current connected peers
 * @param newPeer number of peers with new subnets to connect to
 * @param maxPeer max peer provided as option
 * @param reps our reputation store
 * @param retainRatio: 0 to 1, the ratio to consider disconnecting peers, 90% by default.
 */
export function selectPeersToDisconnect(
  network: INetwork,
  newPeer: number,
  maxPeer: number,
  reps: IReputationStore,
  retainRatio = 0.9
): PeerId[] {
  // TODO: prune useless peers
  // peer that timeouts, that doesn't support required protocols (we still keep those as they might be useful to gossip) or that have bad gossip score later on
  const peers = network.getPeers({connected: true}).map((peer) => peer.id);
  // only disconnect peers if we have >= 90% connected peers
  if (peers.length < maxPeer * retainRatio) return [];
  const numDisconnect = peers.length + newPeer - maxPeer;
  if (numDisconnect <= 0) return [];
  // should not disconnect important peers
  const importantPeers = getImportantPeers(peers, reps);
  const candidatePeers = peers.filter((peer) => !importantPeers.has(peer));
  // worse peer on top
  const sortedPeers = candidatePeers.sort((peer1, peer2) => {
    const peer1Rep = reps.getFromPeerId(peer1);
    const peer2Rep = reps.getFromPeerId(peer2);
    const syncPeers = network.getPeers({connected: true, supportsProtocols: getSyncProtocols()}).map((peer) => peer.id);
    if (syncPeers.includes(peer1) && !syncPeers.includes(peer2)) return 1;
    if (!syncPeers.includes(peer1) && syncPeers.includes(peer2)) return -1;
    if (!peer1Rep.latestMetadata) return -1;
    if (!peer2Rep.latestMetadata) return 1;
    let numSubnet1 = 0;
    let numSubnet2 = 0;
    for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
      if (peer1Rep.latestMetadata.attnets[subnet]) numSubnet1++;
      if (peer2Rep.latestMetadata.attnets[subnet]) numSubnet2++;
    }
    return numSubnet1 - numSubnet2;
  });
  return sortedPeers.slice(0, numDisconnect);
}

/**
 * Peers that should not be disconnected because they are the only connected to a certain subnet.
 * @param peers
 * @param reps
 */
export function getImportantPeers(peers: PeerId[], reps: IReputationStore): Set<PeerId> {
  const importantPeers = new Set<PeerId>();
  for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
    let count = 0;
    let candidatePeer: PeerId | null = null;
    peers.forEach((peer) => {
      const latestMetadata = reps.getFromPeerId(peer).latestMetadata;
      if (latestMetadata && latestMetadata.attnets[subnet]) {
        candidatePeer = peer;
        count++;
      }
    });
    if (count === 1) importantPeers.add(candidatePeer!);
  }
  return importantPeers;
}
