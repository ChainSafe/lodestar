import PeerId from "peer-id";
import {altair, phase0} from "@chainsafe/lodestar-types";
import {shuffle} from "../../../util/shuffle";
import {sortBy} from "../../../util/sortBy";
import {SubnetType} from "../../metadata";
import {RequestedSubnet} from "./subnetMap";

/** Target number of peers we'd like to have connected to a given long-lived subnet */
const MAX_TARGET_SUBNET_PEERS = 6;
/**
 * Instead of attempting to connect the exact amount necessary this will overshoot a little since the success
 * rate of outgoing connections is low, <33%. If we try to connect exactly `targetPeers - connectedPeerCount` the
 * peer count will almost always be just below targetPeers triggering constant discoveries that are not necessary
 */
const PEERS_TO_CONNECT_OVERSHOOT_FACTOR = 3;

type SubnetDiscvQuery = {subnet: number; toSlot: number; maxPeersToDiscover: number};

/**
 * Prioritize which peers to disconect and which to connect. Conditions:
 * - Reach `targetPeers`
 * - Don't exceed `maxPeers`
 * - Ensure there are enough peers per active subnet
 * - Prioritize peers with good score
 */
export function prioritizePeers(
  connectedPeers: {id: PeerId; attnets: phase0.AttestationSubnets; syncnets: altair.SyncSubnets; score: number}[],
  activeAttnets: RequestedSubnet[],
  activeSyncnets: RequestedSubnet[],
  {targetPeers, maxPeers}: {targetPeers: number; maxPeers: number}
): {
  peersToConnect: number;
  peersToDisconnect: PeerId[];
  attnetQueries: SubnetDiscvQuery[];
  syncnetQueries: SubnetDiscvQuery[];
} {
  let peersToConnect = 0;
  const peersToDisconnect: PeerId[] = [];
  const attnetQueries: SubnetDiscvQuery[] = [];
  const syncnetQueries: SubnetDiscvQuery[] = [];

  // To filter out peers that are part of 1+ attnets of interest from possible disconnection
  const peerHasDuty = new Map<string, boolean>();

  for (const {subnets, subnetKey, queries} of [
    {subnets: activeAttnets, subnetKey: SubnetType.attnets, queries: attnetQueries},
    {subnets: activeSyncnets, subnetKey: SubnetType.syncnets, queries: syncnetQueries},
  ]) {
    // Dynamically compute 1 <= TARGET_PEERS_PER_SUBNET <= MAX_TARGET_SUBNET_PEERS
    const targetPeersPerSubnet = Math.min(MAX_TARGET_SUBNET_PEERS, Math.max(1, Math.floor(maxPeers / subnets.length)));

    if (subnets.length > 0) {
      /** Map of peers per subnet, peer may be in multiple arrays */
      const peersPerSubnet = new Map<number, number>();

      for (const peer of connectedPeers) {
        let hasDuty = false;
        for (const {subnet} of subnets) {
          if (peer[subnetKey][subnet]) {
            hasDuty = true;
            peersPerSubnet.set(subnet, 1 + (peersPerSubnet.get(subnet) ?? 0));
          }
        }
        if (hasDuty) {
          peerHasDuty.set(peer.id.toB58String(), true);
        }
      }

      for (const {subnet, toSlot} of subnets) {
        const peersInSubnet = peersPerSubnet.get(subnet) ?? 0;
        if (peersInSubnet < targetPeersPerSubnet) {
          // We need more peers
          queries.push({subnet, toSlot, maxPeersToDiscover: targetPeersPerSubnet - peersInSubnet});
        }
      }
    }
  }

  const connectedPeerCount = connectedPeers.length;

  if (connectedPeerCount < targetPeers) {
    // Need more peers.
    // Instead of attempting to connect the exact amount necessary this will overshoot a little since the success
    // rate of outgoing connections is low, <33%. If we try to connect exactly `targetPeers - connectedPeerCount` the
    // peer count will almost always be just below targetPeers triggering constant discoveries that are not necessary
    peersToConnect = Math.min(
      PEERS_TO_CONNECT_OVERSHOOT_FACTOR * (targetPeers - connectedPeerCount),
      // Never attempt to connect more peers than maxPeers even considering a low chance of dial success
      maxPeers - connectedPeerCount
    );
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
    peersToConnect,
    peersToDisconnect,
    attnetQueries,
    syncnetQueries,
  };
}
