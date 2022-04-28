import PeerId from "peer-id";
import {altair, phase0} from "@chainsafe/lodestar-types";
import {shuffle} from "../../../util/shuffle";
import {sortBy} from "../../../util/sortBy";
import {SubnetType} from "../../metadata";
import {RequestedSubnet} from "./subnetMap";
import {ATTESTATION_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {MapDef} from "../../../util/map";

/** Target number of peers we'd like to have connected to a given long-lived subnet */
const TARGET_SUBNET_PEERS = 6;

/**
 * This is used in the pruning logic. We avoid pruning peers on sync-committees if doing so would
 * lower our peer count below this number. Instead we favour a non-uniform distribution of subnet
 * peers.
 */
const MIN_SYNC_COMMITTEE_PEERS = 2;

/**
 * Lighthouse has this value as 0. However, as monitored in Lodestar mainnet node, the max score is 0
 * and average score is -0.5 to 0 so we want this value to be a little bit more relaxed
 */
const LOW_SCORE_TO_PRUNE_IF_TOO_MANY_PEERS = -2;

/**
 * Instead of attempting to connect the exact amount necessary this will overshoot a little since the success
 * rate of outgoing connections is low, <33%. If we try to connect exactly `targetPeers - connectedPeerCount` the
 * peer count will almost always be just below targetPeers triggering constant discoveries that are not necessary
 */
const PEERS_TO_CONNECT_OVERSHOOT_FACTOR = 3;

type SubnetDiscvQuery = {subnet: number; toSlot: number; maxPeersToDiscover: number};

type PeerInfo = {
  id: PeerId;
  attnets: phase0.AttestationSubnets | null;
  syncnets: altair.SyncSubnets | null;
  score: number;
};

export enum ExcessPeerDisconnectReason {
  LOW_SCORE = "low_score",
  NO_LONG_LIVED_SUBNET = "no_long_lived_subnet",
  TOO_GROUPED_SUBNET = "too_grouped_subnet",
}

/**
 * Prioritize which peers to disconect and which to connect. Conditions:
 * - Reach `targetPeers`
 * - Don't exceed `maxPeers`
 * - Ensure there are enough peers per active subnet
 * - Prioritize peers with good score
 */
export function prioritizePeers(
  connectedPeers: PeerInfo[],
  activeAttnets: RequestedSubnet[],
  activeSyncnets: RequestedSubnet[],
  {targetPeers, maxPeers}: {targetPeers: number; maxPeers: number},
  targetSubnetPeers = TARGET_SUBNET_PEERS
): {
  peersToConnect: number;
  peersToDisconnect: Map<string, PeerId[]>;
  attnetQueries: SubnetDiscvQuery[];
  syncnetQueries: SubnetDiscvQuery[];
  targetSubnetPeers?: number;
} {
  let peersToConnect = 0;
  const peersToDisconnect = new MapDef<string, PeerId[]>(() => []);
  const attnetQueries: SubnetDiscvQuery[] = [];
  const syncnetQueries: SubnetDiscvQuery[] = [];
  const attnetTruebitIndices = new Map<PeerInfo, number[]>();
  const syncnetTruebitIndices = new Map<PeerInfo, number[]>();

  // To filter out peers that are part of 1+ attnets of interest from possible disconnection
  const peerHasDuty = new Map<PeerInfo, boolean>();

  for (const {subnets, subnetKey, queries, bitIndicesByPeer} of [
    {
      subnets: activeAttnets,
      subnetKey: SubnetType.attnets,
      queries: attnetQueries,
      bitIndicesByPeer: attnetTruebitIndices,
    },
    {
      subnets: activeSyncnets,
      subnetKey: SubnetType.syncnets,
      queries: syncnetQueries,
      bitIndicesByPeer: syncnetTruebitIndices,
    },
  ]) {
    if (subnets.length > 0) {
      /** Map of peers per subnet, peer may be in multiple arrays */
      const peersPerSubnet = new Map<number, number>();

      for (const peer of connectedPeers) {
        let hasDuty = false;
        const bitIndices = peer[subnetKey]?.getTrueBitIndexes() ?? [];
        bitIndicesByPeer.set(peer, bitIndices);
        for (const {subnet} of subnets) {
          if (bitIndices.includes(subnet)) {
            hasDuty = true;
            peersPerSubnet.set(subnet, 1 + (peersPerSubnet.get(subnet) ?? 0));
          }
        }
        if (hasDuty) {
          peerHasDuty.set(peer, true);
        }
      }

      for (const {subnet, toSlot} of subnets) {
        const peersInSubnet = peersPerSubnet.get(subnet) ?? 0;
        if (peersInSubnet < targetSubnetPeers) {
          // We need more peers
          queries.push({subnet, toSlot, maxPeersToDiscover: targetSubnetPeers - peersInSubnet});
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
    pruneExcessPeers({
      connectedPeers,
      attnetTruebitIndices,
      syncnetTruebitIndices,
      peerHasDuty,
      targetPeers,
      targetSubnetPeers,
      activeAttnets,
      peersToDisconnect,
    });
  }

  return {
    peersToConnect,
    peersToDisconnect,
    attnetQueries,
    syncnetQueries,
  };
}

/**
 * Remove excess peers back down to our target values.
 * 1. Remove peers that are not subscribed to a subnet (they have less value)
 * 2. Remove worst scoring peers
 * 3. Remove peers that we have many on any particular subnet
 *   - Only consider removing peers on subnet that has > TARGET_SUBNET_PEERS to be safe
 *   - If we have a choice, do not remove peer that would drop us below targetPeersPerAttnetSubnet
 *   - If we have a choice, do not remove peer that would drop us below MIN_SYNC_COMMITTEE_PEERS
 *
 * Although the logic looks complicated, we'd prune 5 peers max per heartbeat based on the mainnet config.
 */
function pruneExcessPeers({
  connectedPeers,
  attnetTruebitIndices,
  syncnetTruebitIndices,
  peerHasDuty,
  targetPeers,
  targetSubnetPeers,
  activeAttnets,
  peersToDisconnect,
}: {
  connectedPeers: PeerInfo[];
  attnetTruebitIndices: Map<PeerInfo, number[]>;
  syncnetTruebitIndices: Map<PeerInfo, number[]>;
  peerHasDuty: Map<PeerInfo, boolean>;
  targetPeers: number;
  targetSubnetPeers: number;
  activeAttnets: RequestedSubnet[];
  peersToDisconnect: MapDef<string, PeerId[]>;
}): void {
  const connectedPeerCount = connectedPeers.length;
  const connectedPeersWithoutDuty = connectedPeers.filter((peer) => !peerHasDuty.get(peer));
  // sort from least score to high
  const worstPeers = sortBy(shuffle(connectedPeersWithoutDuty), (peer) => peer.score);
  let peersToDisconnectCount = 0;
  const noLongLivedSubnetPeersToDisconnect: PeerId[] = [];
  const peersToDisconnectTarget = connectedPeerCount - targetPeers;

  // 1. Lodestar prefers disconnecting peers that does not have long lived subnets
  // See https://github.com/ChainSafe/lodestar/issues/3940
  // peers with low score will be disconnected through heartbeat in the end
  for (const peer of worstPeers) {
    const hasLongLivedSubnet =
      (attnetTruebitIndices.get(peer)?.length ?? 0) > 0 || (syncnetTruebitIndices.get(peer)?.length ?? 0) > 0;
    if (!hasLongLivedSubnet && peersToDisconnectCount < peersToDisconnectTarget) {
      noLongLivedSubnetPeersToDisconnect.push(peer.id);
      peersToDisconnectCount++;
    }
  }
  peersToDisconnect.set(ExcessPeerDisconnectReason.NO_LONG_LIVED_SUBNET, noLongLivedSubnetPeersToDisconnect);

  // 2. Disconnect peers that have score < LOW_SCORE_TO_PRUNE_IF_TOO_MANY_PEERS
  const badScorePeersToDisconnect: PeerId[] = [];
  for (const peer of worstPeers) {
    if (
      peer.score < LOW_SCORE_TO_PRUNE_IF_TOO_MANY_PEERS &&
      peersToDisconnectCount < peersToDisconnectTarget &&
      !noLongLivedSubnetPeersToDisconnect.includes(peer.id)
    ) {
      badScorePeersToDisconnect.push(peer.id);
      peersToDisconnectCount++;
    }
  }
  peersToDisconnect.set(ExcessPeerDisconnectReason.LOW_SCORE, badScorePeersToDisconnect);

  // 3. Disconnect peers that are too grouped on any given subnet
  const tooGroupedPeersToDisconnect: PeerId[] = [];
  if (peersToDisconnectCount < peersToDisconnectTarget) {
    // PeerInfo array by attestation subnet
    const subnetToPeers = new MapDef<number, PeerInfo[]>(() => []);
    // number of peers per long lived sync committee
    const syncCommitteePeerCount = new MapDef<number, number>(() => 0);

    // populate the above variables
    for (const peer of connectedPeers) {
      if (noLongLivedSubnetPeersToDisconnect.includes(peer.id) || badScorePeersToDisconnect.includes(peer.id)) {
        continue;
      }
      for (const subnet of attnetTruebitIndices.get(peer) ?? []) {
        subnetToPeers.getOrDefault(subnet).push(peer);
      }
      for (const subnet of syncnetTruebitIndices.get(peer) ?? []) {
        syncCommitteePeerCount.set(subnet, 1 + syncCommitteePeerCount.getOrDefault(subnet));
      }
    }

    while (peersToDisconnectCount < peersToDisconnectTarget) {
      const maxPeersSubnet: number | null = findMaxPeersSubnet(subnetToPeers, targetSubnetPeers);
      // peers are NOT too grouped on any given subnet, finish this loop
      if (maxPeersSubnet === null) break;
      const peersOnMostGroupedSubnet = subnetToPeers.get(maxPeersSubnet);
      if (peersOnMostGroupedSubnet === undefined) break;

      // Find peers to remove from the current maxPeersSubnet
      const removedPeer = findPeerToRemove(
        subnetToPeers,
        syncCommitteePeerCount,
        peersOnMostGroupedSubnet,
        attnetTruebitIndices,
        syncnetTruebitIndices,
        targetSubnetPeers,
        activeAttnets
      );

      // If we have successfully found a candidate peer to prune, prune it,
      // otherwise all peers on this subnet should not be removed.
      // In this case, we remove all peers from the pruning logic and try another subnet.
      if (removedPeer != null) {
        // recalculate variables
        removePeerFromSubnetToPeers(subnetToPeers, removedPeer);
        decreaseSynccommitteePeerCount(syncCommitteePeerCount, syncnetTruebitIndices.get(removedPeer));

        tooGroupedPeersToDisconnect.push(removedPeer.id);
        peersToDisconnectCount++;
      } else {
        // no peer to remove from the maxPeersSubnet
        // should continue with the 2nd biggest maxPeersSubnet
        subnetToPeers.delete(maxPeersSubnet);
      }
    }

    peersToDisconnect.set(ExcessPeerDisconnectReason.TOO_GROUPED_SUBNET, tooGroupedPeersToDisconnect);
  }
}

/**
 * Find subnet that has the most peers and > TARGET_SUBNET_PEERS, return null if peers are not grouped
 * to any subnets.
 */
function findMaxPeersSubnet(subnetToPeers: Map<number, PeerInfo[]>, targetSubnetPeers: number): number | null {
  let maxPeersSubnet: number | null = null;
  let maxPeerCountPerSubnet = -1;

  for (const [subnet, peers] of subnetToPeers) {
    if (peers.length > targetSubnetPeers && peers.length > maxPeerCountPerSubnet) {
      maxPeersSubnet = subnet;
      maxPeerCountPerSubnet = peers.length;
    }
  }

  return maxPeersSubnet;
}

/**
 * Find peers to remove from the current maxPeersSubnet.
 * In the long term, this logic will help us gradually find peers with more long lived subnet.
 * Return null if we should not remove any peer on the most grouped subnet.
 */
function findPeerToRemove(
  subnetToPeers: Map<number, PeerInfo[]>,
  syncCommitteePeerCount: Map<number, number>,
  peersOnMostGroupedSubnet: PeerInfo[],
  attnetTruebitIndices: Map<PeerInfo, number[]>,
  syncnetTruebitIndices: Map<PeerInfo, number[]>,
  targetSubnetPeers: number,
  activeAttnets: RequestedSubnet[]
): PeerInfo | null {
  const peersOnSubnet = sortBy(peersOnMostGroupedSubnet, (peer) => attnetTruebitIndices.get(peer)?.length ?? 0);
  let removedPeer: PeerInfo | null = null;
  for (const candidatePeer of peersOnSubnet) {
    // new logic of lodestar
    const attnetIndices = attnetTruebitIndices.get(candidatePeer) ?? [];
    if (attnetIndices.length > 0) {
      const requestedSubnets = activeAttnets.map((activeAttnet) => activeAttnet.subnet);
      let minAttnetCount = ATTESTATION_SUBNET_COUNT;
      // intersection of requested subnets and subnets that peer subscribes to
      for (const subnet of requestedSubnets) {
        const numSubnetPeers = subnetToPeers.get(subnet)?.length;
        if (numSubnetPeers !== undefined && numSubnetPeers < minAttnetCount && attnetIndices.includes(subnet)) {
          minAttnetCount = numSubnetPeers;
        }
      }
      // shouldn't remove this peer because it drops us below targetSubnetPeers
      if (minAttnetCount <= targetSubnetPeers) continue;
    }

    // same logic to lighthouse
    const syncnetIndices = syncnetTruebitIndices.get(candidatePeer) ?? [];
    // The peer is subscribed to some long-lived sync-committees
    if (syncnetIndices.length > 0) {
      const minSubnetCount = Math.min(...syncnetIndices.map((subnet) => syncCommitteePeerCount.get(subnet) ?? 0));
      // If the minimum count is our target or lower, we
      // shouldn't remove this peer, because it drops us lower
      // than our target
      if (minSubnetCount <= MIN_SYNC_COMMITTEE_PEERS) continue;
    }

    // ok, found a peer to remove
    removedPeer = candidatePeer;
    break;
  }

  return removedPeer;
}

/**
 * Remove a peer from subnetToPeers map.
 */
function removePeerFromSubnetToPeers(subnetToPeers: Map<number, PeerInfo[]>, removedPeer: PeerInfo): void {
  for (const peers of subnetToPeers.values()) {
    const index = peers.findIndex((peer) => peer === removedPeer);
    if (index >= 0) {
      peers.splice(index, 1);
    }
  }
}

/**
 * Decrease the syncCommitteePeerCount from the specified committees set
 */
function decreaseSynccommitteePeerCount(
  syncCommitteePeerCount: MapDef<number, number>,
  committees: number[] | undefined
): void {
  if (committees) {
    for (const syncCommittee of committees) {
      syncCommitteePeerCount.set(syncCommittee, Math.max(syncCommitteePeerCount.getOrDefault(syncCommittee) - 1, 0));
    }
  }
}
