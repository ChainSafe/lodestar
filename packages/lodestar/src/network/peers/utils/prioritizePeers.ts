import PeerId from "peer-id";
import {altair, phase0} from "@chainsafe/lodestar-types";
import {shuffle} from "../../../util/shuffle";
import {sortBy} from "../../../util/sortBy";
import {SubnetType} from "../../metadata";
import {RequestedSubnet} from "./subnetMap";
import {ATTESTATION_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {MapDef} from "../../../util/map";

/** Target number of peers we'd like to have connected to a given long-lived subnet */
const MAX_TARGET_SUBNET_PEERS = 6;
/** Minimal number of peers we'd like to have connected to a given long-lived subnet */
const MIN_TARGET_SUBNET_PEERS = 2;

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
  {targetPeers, maxPeers}: {targetPeers: number; maxPeers: number}
): {
  peersToConnect: number;
  peersToDisconnect: PeerId[];
  attnetQueries: SubnetDiscvQuery[];
  syncnetQueries: SubnetDiscvQuery[];
} {
  let peersToConnect = 0;
  const peersToDisconnect = new Set<PeerId>();
  const attnetQueries: SubnetDiscvQuery[] = [];
  const syncnetQueries: SubnetDiscvQuery[] = [];
  const attnetTruebitIndices = new Map<PeerInfo, number[]>();
  const syncnetTruebitIndices = new Map<PeerInfo, number[]>();

  // To filter out peers that are part of 1+ attnets of interest from possible disconnection
  const peerHasDuty = new Map<PeerInfo, boolean>();
  // Dynamically compute MIN_TARGET_SUBNET_PEERS <= TARGET_PEERS_PER_SUBNET <= MAX_TARGET_SUBNET_PEERS
  // TODO: see if we need to tweak this logic as lighthouse always requires MAX_TARGET_SUBNET_PEERS
  const targetPeersPerAttnetSubnet = Math.min(
    MAX_TARGET_SUBNET_PEERS,
    maxPeers,
    Math.max(MIN_TARGET_SUBNET_PEERS, Math.floor(maxPeers / activeAttnets.length))
  );
  const targetPeersPerSyncnetSubnet = Math.min(
    MAX_TARGET_SUBNET_PEERS,
    maxPeers,
    Math.max(MIN_TARGET_SUBNET_PEERS, Math.floor(maxPeers / activeSyncnets.length))
  );

  for (const {subnets, subnetKey, queries, bitIndicesByPeer, targetPeersPerSubnet} of [
    {
      subnets: activeAttnets,
      subnetKey: SubnetType.attnets,
      queries: attnetQueries,
      bitIndicesByPeer: attnetTruebitIndices,
      targetPeersPerSubnet: targetPeersPerAttnetSubnet,
    },
    {
      subnets: activeSyncnets,
      subnetKey: SubnetType.syncnets,
      queries: syncnetQueries,
      bitIndicesByPeer: syncnetTruebitIndices,
      targetPeersPerSubnet: targetPeersPerSyncnetSubnet,
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
    pruneExcessPeers({
      connectedPeers,
      attnetTruebitIndices,
      syncnetTruebitIndices,
      peerHasDuty,
      targetPeers,
      targetPeersPerAttnetSubnet,
      activeAttnets,
      peersToDisconnect,
    });
  }

  return {
    peersToConnect,
    peersToDisconnect: Array.from(peersToDisconnect),
    attnetQueries,
    syncnetQueries,
  };
}

/**
 * Remove excess peers back down to our target values.
 * 1. Remove worst scoring peers
 * 2. Remove peers that are not subscribed to a subnet (they have less value)
 * 3. Remove peers that we have many on any particular subnet
 *   - Only consider removing peers on subnet that has > MAX_TARGET_SUBNET_PEERS to be safe
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
  targetPeersPerAttnetSubnet,
  activeAttnets,
  peersToDisconnect,
}: {
  connectedPeers: PeerInfo[];
  attnetTruebitIndices: Map<PeerInfo, number[]>;
  syncnetTruebitIndices: Map<PeerInfo, number[]>;
  peerHasDuty: Map<PeerInfo, boolean>;
  targetPeers: number;
  targetPeersPerAttnetSubnet: number;
  activeAttnets: RequestedSubnet[];
  peersToDisconnect: Set<PeerId>;
}): void {
  const connectedPeerCount = connectedPeers.length;
  const connectedPeersWithoutDuty = connectedPeers.filter((peer) => !peerHasDuty.get(peer));
  // sort from least score to high
  const worstPeers = sortBy(shuffle(connectedPeersWithoutDuty), (peer) => peer.score);

  // Remove peers that have score < LOW_SCORE_TO_PRUNE_IF_TOO_MANY_PEERS or not have long lived subnet
  for (const peer of worstPeers) {
    const hasLongLivedSubnet =
      (attnetTruebitIndices.get(peer)?.length ?? 0) > 0 || (syncnetTruebitIndices.get(peer)?.length ?? 0) > 0;
    if (
      (!hasLongLivedSubnet || peer.score < LOW_SCORE_TO_PRUNE_IF_TOO_MANY_PEERS) &&
      peersToDisconnect.size < connectedPeerCount - targetPeers
    ) {
      peersToDisconnect.add(peer.id);
    }
  }

  // Remove peers that are too grouped on any given subnet
  if (peersToDisconnect.size < connectedPeerCount - targetPeers) {
    // PeerInfo array by attestation subnet
    const subnetToPeers = new MapDef<number, PeerInfo[]>(() => []);
    // number of peers per long lived sync committee
    const syncCommitteePeerCount = new MapDef<number, number>(() => 0);
    // no need to create peerToSyncCommittee, use syncnetTruebitIndices

    // populate the above variables
    for (const peer of connectedPeers) {
      if (peersToDisconnect.has(peer.id)) {
        continue;
      }
      for (const subnet of attnetTruebitIndices.get(peer) ?? []) {
        subnetToPeers.getOrDefault(subnet).push(peer);
      }
      for (const subnet of syncnetTruebitIndices.get(peer) ?? []) {
        syncCommitteePeerCount.set(subnet, 1 + syncCommitteePeerCount.getOrDefault(subnet));
      }
    }

    while (peersToDisconnect.size < connectedPeerCount - targetPeers) {
      let maxPeersSubnet: number | null = null;
      let maxPeerCountPerSubnet = -1;
      // find subnet that has the most peers and > MAX_TARGET_SUBNET_PEERS
      // prater has up to 15-20 peers per subnet at most
      // however mainnet has up to 6-10 peers per subnet at most
      for (const [subnet, peers] of subnetToPeers) {
        if (peers.length > Math.min(targetPeers, MAX_TARGET_SUBNET_PEERS) && peers.length > maxPeerCountPerSubnet) {
          maxPeersSubnet = subnet;
          maxPeerCountPerSubnet = peers.length;
        }
      }

      // peers are NOT too grouped on any given subnet, finish this function
      if (maxPeersSubnet === null) break;
      const peersOnMostGroupedSubnet = subnetToPeers.get(maxPeersSubnet);
      if (peersOnMostGroupedSubnet === undefined) break;

      const removedPeer = findPeerToRemove(
        subnetToPeers,
        syncCommitteePeerCount,
        peersOnMostGroupedSubnet,
        attnetTruebitIndices,
        syncnetTruebitIndices,
        targetPeersPerAttnetSubnet,
        activeAttnets
      );

      // If we have successfully found a candidate peer to prune, prune it,
      // otherwise all peers on this subnet should not be removed.
      // In this case, we remove all peers from the pruning logic and try another subnet.
      if (removedPeer != null) {
        // recalculate variables
        for (const peers of subnetToPeers.values()) {
          const index = peers.findIndex((peer) => peer === removedPeer);
          if (index >= 0) peers.splice(index, 1);
        }
        const knownSyncCommittees = syncnetTruebitIndices.get(removedPeer);
        if (knownSyncCommittees) {
          for (const syncCommittee of knownSyncCommittees) {
            syncCommitteePeerCount.set(
              syncCommittee,
              Math.max(syncCommitteePeerCount.getOrDefault(syncCommittee) - 1, 0)
            );
          }
        }

        peersToDisconnect.add(removedPeer.id);
      } else {
        // should continue with the 2nd biggest maxPeersSubnet
        subnetToPeers.delete(maxPeersSubnet);
      }
    }
  }
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
  targetPeersPerAttnetSubnet: number,
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
      for (const subnet of requestedSubnets) {
        const numSubnetPeers = subnetToPeers.get(subnet)?.length;
        if (attnetIndices.includes(subnet) && numSubnetPeers !== undefined && numSubnetPeers < minAttnetCount) {
          minAttnetCount = numSubnetPeers;
        }
      }
      // shouldn't remove this peer because it drops us below targetPeersPerAttnetSubnet
      if (minAttnetCount <= targetPeersPerAttnetSubnet) continue;
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
