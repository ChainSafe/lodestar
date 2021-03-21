import PeerId from "peer-id";
import {phase0} from "@chainsafe/lodestar-types";
import {shuffle} from "../../../util/shuffle";
import {sortBy} from "../../../util/sortBy";
import {AttSubnetQuery} from "../discover";

/** Target number of peers we'd like to have connected to a given long-lived subnet */
const MAX_TARGET_SUBNET_PEERS = 6;

/**
 * Prioritize which peers to disconect and which to connect. Conditions:
 * - Reach `targetPeers`
 * - Don't exceed `maxPeers`
 * - Ensure there are enough peers per active subnet
 * - Prioritize peers with good score
 */
export function prioritizePeers(
  connectedPeers: {id: PeerId; attnets: phase0.AttestationSubnets; score: number}[],
  activeSubnetIds: number[],
  {targetPeers, maxPeers}: {targetPeers: number; maxPeers: number}
): {peersToDisconnect: PeerId[]; peersToConnect: number; discv5Queries: AttSubnetQuery[]} {
  const peersToDisconnect: PeerId[] = [];
  let peersToConnect = 0;
  const discv5Queries: AttSubnetQuery[] = [];

  // Dynamically compute 1 <= TARGET_PEERS_PER_SUBNET <= MAX_TARGET_SUBNET_PEERS
  const targetPeersPerSubnet = Math.min(
    MAX_TARGET_SUBNET_PEERS,
    Math.max(1, Math.floor(maxPeers / activeSubnetIds.length))
  );

  // To filter out peers that are part of 1+ attnets of interest from possible disconnection
  const peerHasDuty = new Map<string, boolean>();

  if (activeSubnetIds.length > 0) {
    /** Map of peers per subnet, peer may be in multiple arrays */
    const peersPerSubnet = new Map<number, number>();

    for (const peer of connectedPeers) {
      for (const subnetId of activeSubnetIds) {
        if (peer.attnets[subnetId]) {
          peerHasDuty.set(peer.id.toB58String(), true);
          peersPerSubnet.set(subnetId, 1 + (peersPerSubnet.get(subnetId) || 0));
        }
      }
    }

    for (const subnetId of activeSubnetIds) {
      const peersInSubnet = peersPerSubnet.get(subnetId) ?? 0;
      if (peersInSubnet < targetPeersPerSubnet) {
        // We need more peers
        discv5Queries.push({subnetId, maxPeersToDiscover: targetPeersPerSubnet - peersInSubnet});
      }
    }
  }

  const connectedPeerCount = connectedPeers.length;

  if (connectedPeerCount < targetPeers) {
    // Need more peers,
    peersToConnect = targetPeers - connectedPeerCount;
  } else if (connectedPeerCount > targetPeers) {
    // Too much peers, disconnect worst

    // Current peer sorting:
    // - All connected with no future duty, sorted by score (worst first) (ties broken random)

    // TODO: Priotize peers for disconection better, don't just filter by duty but
    // reduce their probability of being disconected, mantaining `targetPeersPerSubnet`

    const connectedPeersWithoutDuty = connectedPeers.filter((peer) => !peerHasDuty.get(peer.id.toB58String()));
    // sort from least score to high
    const worstPeers = sortBy(shuffle(connectedPeersWithoutDuty), (peer) => peer.score);
    for (const peer of worstPeers.slice(0, connectedPeerCount - targetPeers)) {
      peersToDisconnect.push(peer.id);
    }
  }

  return {
    peersToDisconnect,
    peersToConnect,
    discv5Queries,
  };
}
