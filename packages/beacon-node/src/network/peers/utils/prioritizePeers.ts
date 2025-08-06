import {BitArray} from "@chainsafe/ssz";
import {Direction, PeerId} from "@libp2p/interface";
import {ATTESTATION_SUBNET_COUNT, NUMBER_OF_CUSTODY_GROUPS, SYNC_COMMITTEE_SUBNET_COUNT} from "@lodestar/params";
import {CustodyIndex, Status, SubnetID, altair, phase0} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";
import {shuffle} from "../../../util/shuffle.js";
import {sortBy} from "../../../util/sortBy.js";
import {NetworkCoreMetrics} from "../../core/metrics.js";
import {RequestedSubnet} from "./subnetMap.js";

/** Target number of peers we'd like to have connected to a given long-lived subnet */
const TARGET_SUBNET_PEERS = 6;

/**
 * This is for non-sampling groups only. This is a very easy number to achieve given an average of 6.25 peers per column subnet on public networks.
 * This is needed to always maintain some minimum peers on all subnets so that when we publish a block, we're sure we pubish to all column subnets.
 */
const TARGET_GROUP_PEERS_PER_SUBNET = 4;

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

/**
 * Keep at least 10% of outbound peers. For rationale, see https://github.com/ChainSafe/lodestar/issues/2215
 */
const OUTBOUND_PEERS_RATIO = 0.1;

const attnetsZero = BitArray.fromBitLen(ATTESTATION_SUBNET_COUNT);
const syncnetsZero = BitArray.fromBitLen(SYNC_COMMITTEE_SUBNET_COUNT);

type SubnetDiscvQuery = {subnet: SubnetID; toSlot: number; maxPeersToDiscover: number};

/**
 * A map of das custody group index to maxPeersToDiscover
 */
export type CustodyGroupQueries = Map<CustodyIndex, number>;

/**
 * Comparison of our status vs a peer's status.
 *
 * The main usage of this score is to feed into peer priorization during syncing, and especially when the node is having trouble finding data during syncing
 *
 * For network stability, we DON'T distinguish peers that are far behind us vs peers that are close to us.
 */
enum StatusScore {
  /** The peer is close to our chain */
  CLOSE_TO_US = -1,
  /** The peer is far ahead of chain */
  FAR_AHEAD = 0,
}

/**
 * In practice, this score only tracks if the peer is far ahead of us or not during syncing.
 * When the node is synced, the peer is always CLOSE_TO_US.
 */
function computeStatusScore(ours: Status, theirs: Status | null, opts: PrioritizePeersOpts): StatusScore {
  if (theirs === null) {
    return StatusScore.CLOSE_TO_US;
  }

  if (theirs.finalizedEpoch > ours.finalizedEpoch) {
    return StatusScore.FAR_AHEAD;
  }

  if (theirs.headSlot > ours.headSlot + opts.starvationThresholdSlots) {
    return StatusScore.FAR_AHEAD;
  }

  // It's dangerous to downscore peers that are far behind.
  // This means we'd be more likely to disconnect peers that are attempting to sync, which would affect network stability.
  // if (ours.headSlot > theirs.headSlot + opts.starvationThresholdSlots) {
  //   return StatusScore.FAR_BEHIND;
  // }

  return StatusScore.CLOSE_TO_US;
}

type PeerInfo = {
  id: PeerId;
  direction: Direction | null;
  statusScore: StatusScore;
  attnets: phase0.AttestationSubnets;
  syncnets: altair.SyncSubnets;
  samplingGroups: CustodyIndex[];
  attnetsTrueBitIndices: number[];
  syncnetsTrueBitIndices: number[];
  score: number;
};

export type PrioritizePeersOpts = {
  targetPeers: number;
  maxPeers: number;
  targetGroupPeers: number;
  status: Status;
  starved: boolean;
  starvationPruneRatio: number;
  starvationThresholdSlots: number;
  outboundPeersRatio?: number;
  targetSubnetPeers?: number;
};

export enum ExcessPeerDisconnectReason {
  LOW_SCORE = "low_score",
  NO_LONG_LIVED_SUBNET = "no_long_lived_subnet",
  TOO_GROUPED_SUBNET = "too_grouped_subnet",
  FIND_BETTER_PEERS = "find_better_peers",
}

/**
 * Prioritize which peers to disconect and which to connect. Conditions:
 * - Reach `targetPeers`
 *   - If we're starved for data, prune additional peers
 * - Don't exceed `maxPeers`
 * - Ensure there are enough peers per column subnets, attestation subnets and sync committee subnets
 * - Prioritize peers with good score
 *
 * pre-fulu samplingGroups is not used and this function returns empty custodyGroupQueries
 */
export function prioritizePeers(
  connectedPeersInfo: {
    id: PeerId;
    direction: Direction | null;
    status: Status | null;
    attnets: phase0.AttestationSubnets | null;
    syncnets: altair.SyncSubnets | null;
    samplingGroups: CustodyIndex[] | null;
    score: number;
  }[],
  activeAttnets: RequestedSubnet[],
  activeSyncnets: RequestedSubnet[],
  samplingGroups: CustodyIndex[] | undefined,
  opts: PrioritizePeersOpts,
  metrics: NetworkCoreMetrics | null
): {
  peersToConnect: number;
  peersToDisconnect: Map<ExcessPeerDisconnectReason, PeerId[]>;
  attnetQueries: SubnetDiscvQuery[];
  syncnetQueries: SubnetDiscvQuery[];
  custodyGroupQueries: CustodyGroupQueries;
} {
  const {targetPeers, maxPeers} = opts;

  let peersToConnect = 0;
  const peersToDisconnect = new MapDef<ExcessPeerDisconnectReason, PeerId[]>(() => []);

  // Pre-compute trueBitIndexes for re-use below. Set null subnets Maps to default zero value
  const connectedPeers = connectedPeersInfo.map(
    (peer): PeerInfo => ({
      id: peer.id,
      direction: peer.direction,
      statusScore: computeStatusScore(opts.status, peer.status, opts),
      attnets: peer.attnets ?? attnetsZero,
      syncnets: peer.syncnets ?? syncnetsZero,
      samplingGroups: peer.samplingGroups ?? [],
      attnetsTrueBitIndices: peer.attnets?.getTrueBitIndexes() ?? [],
      syncnetsTrueBitIndices: peer.syncnets?.getTrueBitIndexes() ?? [],
      score: peer.score,
    })
  );

  const {attnetQueries, syncnetQueries, custodyGroupQueries, dutiesByPeer} = requestSubnetPeers(
    connectedPeers,
    activeAttnets,
    activeSyncnets,
    samplingGroups,
    opts,
    metrics
  );

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
    pruneExcessPeers(connectedPeers, dutiesByPeer, activeAttnets, peersToDisconnect, opts);
  }

  return {
    peersToConnect,
    peersToDisconnect,
    attnetQueries,
    syncnetQueries,
    custodyGroupQueries,
  };
}

/**
 * If more peers are needed in attnets and syncnets and column subnets, create SubnetDiscvQuery for each subnet
 * pre-fulu samplingGroups is not used and this function returns empty custodyGroupQueries
 */
function requestSubnetPeers(
  connectedPeers: PeerInfo[],
  activeAttnets: RequestedSubnet[],
  activeSyncnets: RequestedSubnet[],
  ourSamplingGroups: CustodyIndex[] | undefined,
  opts: PrioritizePeersOpts,
  metrics: NetworkCoreMetrics | null
): {
  attnetQueries: SubnetDiscvQuery[];
  syncnetQueries: SubnetDiscvQuery[];
  custodyGroupQueries: CustodyGroupQueries;
  dutiesByPeer: Map<PeerInfo, number>;
} {
  const {targetSubnetPeers = TARGET_SUBNET_PEERS} = opts;
  const attnetQueries: SubnetDiscvQuery[] = [];
  const syncnetQueries: SubnetDiscvQuery[] = [];

  // To filter out peers containing enough attnets of interest from possible disconnection
  const dutiesByPeer = new Map<PeerInfo, number>();

  // attnets, do we need queries for more peers
  if (activeAttnets.length > 0) {
    /** Map of peers per subnet, peer may be in multiple arrays */
    const peersPerSubnet = new Map<number, number>();

    for (const peer of connectedPeers) {
      const trueBitIndices = peer.attnetsTrueBitIndices;
      let dutyCount = 0;
      for (const {subnet} of activeAttnets) {
        if (trueBitIndices.includes(subnet)) {
          dutyCount += 1;
          peersPerSubnet.set(subnet, 1 + (peersPerSubnet.get(subnet) ?? 0));
        }
      }
      dutiesByPeer.set(peer, dutyCount);
    }

    for (const {subnet, toSlot} of activeAttnets) {
      const peersInSubnet = peersPerSubnet.get(subnet) ?? 0;
      if (peersInSubnet < targetSubnetPeers) {
        // We need more peers
        attnetQueries.push({subnet, toSlot, maxPeersToDiscover: targetSubnetPeers - peersInSubnet});
      }
    }
  }

  // syncnets, do we need queries for more peers
  if (activeSyncnets.length > 0) {
    /** Map of peers per subnet, peer may be in multiple arrays */
    const peersPerSubnet = new Map<number, number>();

    for (const peer of connectedPeers) {
      const trueBitIndices = peer.syncnetsTrueBitIndices;
      let dutyCount = dutiesByPeer.get(peer) ?? 0;
      for (const {subnet} of activeSyncnets) {
        if (trueBitIndices.includes(subnet)) {
          dutyCount += 1;
          peersPerSubnet.set(subnet, 1 + (peersPerSubnet.get(subnet) ?? 0));
        }
      }
      dutiesByPeer.set(peer, dutyCount);
    }

    for (const {subnet, toSlot} of activeSyncnets) {
      const peersInSubnet = peersPerSubnet.get(subnet) ?? 0;
      if (peersInSubnet < targetSubnetPeers) {
        // We need more peers
        syncnetQueries.push({subnet, toSlot, maxPeersToDiscover: targetSubnetPeers - peersInSubnet});
      }
    }
  }

  const custodyGroupQueries: CustodyGroupQueries = new Map();
  // pre-fulu
  if (ourSamplingGroups == null) {
    return {attnetQueries, syncnetQueries, custodyGroupQueries, dutiesByPeer};
  }

  // column subnets, do we need queries for more peers
  const targetGroupPeersPerSamplingGroup = opts.targetGroupPeers;
  const peersPerGroup = new Map<CustodyIndex, number>();
  for (const peer of connectedPeers) {
    const peerSamplingGroups = peer.samplingGroups;
    for (const group of peerSamplingGroups) {
      peersPerGroup.set(group, 1 + (peersPerGroup.get(group) ?? 0));
    }
  }

  const ourSamplingGroupSet = new Set(ourSamplingGroups);
  for (let groupIndex = 0; groupIndex < NUMBER_OF_CUSTODY_GROUPS; groupIndex++) {
    const peersInGroup = peersPerGroup.get(groupIndex) ?? 0;
    metrics?.peerCountPerSamplingGroup.set({groupIndex}, peersInGroup);
    const targetGroupPeers = ourSamplingGroupSet.has(groupIndex)
      ? targetGroupPeersPerSamplingGroup
      : TARGET_GROUP_PEERS_PER_SUBNET;
    if (peersInGroup < targetGroupPeers) {
      // We need more peers
      custodyGroupQueries.set(groupIndex, targetGroupPeers - peersInGroup);
    }
  }

  return {attnetQueries, syncnetQueries, custodyGroupQueries, dutiesByPeer};
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
function pruneExcessPeers(
  connectedPeers: PeerInfo[],
  dutiesByPeer: Map<PeerInfo, number>,
  activeAttnets: RequestedSubnet[],
  peersToDisconnect: MapDef<ExcessPeerDisconnectReason, PeerId[]>,
  opts: PrioritizePeersOpts
): void {
  const {targetPeers, targetSubnetPeers = TARGET_SUBNET_PEERS, outboundPeersRatio = OUTBOUND_PEERS_RATIO} = opts;
  const connectedPeerCount = connectedPeers.length;
  const outboundPeersTarget = Math.round(outboundPeersRatio * connectedPeerCount);

  // Count outbound peers
  let outboundPeers = 0;
  for (const peer of connectedPeers) {
    if (peer.direction === "outbound") {
      outboundPeers++;
    }
  }

  let outboundPeersEligibleForPruning = 0;

  const sortedPeers = sortPeersToPrune(connectedPeers, dutiesByPeer);

  const peersEligibleForPruning = sortedPeers
    // Then, iterate from highest score to lowest doing a manual filter for duties and outbound ratio
    .filter((peer) => {
      // Peers with duties are not eligible for pruning
      if ((dutiesByPeer.get(peer) ?? 0) > 0) {
        return false;
      }

      // Peers far ahead when we're starved for data are not eligible for pruning
      if (opts.starved && peer.statusScore === StatusScore.FAR_AHEAD) {
        return false;
      }

      // outbound peers up to OUTBOUND_PEER_RATIO sorted by highest score and not eligible for pruning
      if (peer.direction === "outbound") {
        if (outboundPeers - outboundPeersEligibleForPruning > outboundPeersTarget) {
          outboundPeersEligibleForPruning++;
        } else {
          return false;
        }
      }

      return true;
    });

  let peersToDisconnectCount = 0;
  const noLongLivedSubnetPeersToDisconnect: PeerId[] = [];

  const peersToDisconnectTarget =
    // if we're starved for data, prune additional peers
    connectedPeerCount - targetPeers + (opts.starved ? targetPeers * opts.starvationPruneRatio : 0);

  // 1. Lodestar prefers disconnecting peers that does not have long lived subnets
  // See https://github.com/ChainSafe/lodestar/issues/3940
  // peers with low score will be disconnected through heartbeat in the end
  for (const peer of peersEligibleForPruning) {
    const hasLongLivedSubnet = peer.attnetsTrueBitIndices.length > 0 || peer.syncnetsTrueBitIndices.length > 0;
    if (!hasLongLivedSubnet && peersToDisconnectCount < peersToDisconnectTarget) {
      noLongLivedSubnetPeersToDisconnect.push(peer.id);
      peersToDisconnectCount++;
    }
  }
  peersToDisconnect.set(ExcessPeerDisconnectReason.NO_LONG_LIVED_SUBNET, noLongLivedSubnetPeersToDisconnect);

  // 2. Disconnect peers that have score < LOW_SCORE_TO_PRUNE_IF_TOO_MANY_PEERS
  const badScorePeersToDisconnect: PeerId[] = [];
  for (const peer of peersEligibleForPruning) {
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
      for (const subnet of peer.attnetsTrueBitIndices) {
        subnetToPeers.getOrDefault(subnet).push(peer);
      }
      for (const subnet of peer.syncnetsTrueBitIndices) {
        syncCommitteePeerCount.set(subnet, 1 + syncCommitteePeerCount.getOrDefault(subnet));
      }
    }

    while (peersToDisconnectCount < peersToDisconnectTarget) {
      const maxPeersSubnet = findMaxPeersSubnet(subnetToPeers, targetSubnetPeers);
      // peers are NOT too grouped on any given subnet, finish this loop
      if (maxPeersSubnet === null) {
        break;
      }

      const peersOnMostGroupedSubnet = subnetToPeers.get(maxPeersSubnet);
      if (peersOnMostGroupedSubnet === undefined) {
        break;
      }

      // Find peers to remove from the current maxPeersSubnet
      const removedPeer = findPeerToRemove(
        subnetToPeers,
        syncCommitteePeerCount,
        peersOnMostGroupedSubnet,
        targetSubnetPeers,
        activeAttnets
      );

      // If we have successfully found a candidate peer to prune, prune it,
      // otherwise all peers on this subnet should not be removed.
      // In this case, we remove all peers from the pruning logic and try another subnet.
      if (removedPeer != null) {
        // recalculate variables
        removePeerFromSubnetToPeers(subnetToPeers, removedPeer);
        decreaseSynccommitteePeerCount(syncCommitteePeerCount, removedPeer.syncnetsTrueBitIndices);

        tooGroupedPeersToDisconnect.push(removedPeer.id);
        peersToDisconnectCount++;
      } else {
        // no peer to remove from the maxPeersSubnet
        // should continue with the 2nd biggest maxPeersSubnet
        subnetToPeers.delete(maxPeersSubnet);
      }
    }

    peersToDisconnect.set(ExcessPeerDisconnectReason.TOO_GROUPED_SUBNET, tooGroupedPeersToDisconnect);

    // 4. Ensure to always to prune to target peers
    // In rare case, all peers may have duties and good score but very low long lived subnet,
    // and not too grouped to any subnets, we need to always disconnect peers until it reaches targetPeers
    // because we want to keep improving peers (long lived subnets + score)
    // otherwise we'll not able to accept new peer connection to consider better peers
    // see https://github.com/ChainSafe/lodestar/issues/5198
    const remainingPeersToDisconnect: PeerId[] = [];
    for (const {id} of sortedPeers) {
      if (peersToDisconnectCount >= peersToDisconnectTarget) {
        break;
      }
      if (
        noLongLivedSubnetPeersToDisconnect.includes(id) ||
        badScorePeersToDisconnect.includes(id) ||
        tooGroupedPeersToDisconnect.includes(id)
      ) {
        continue;
      }
      remainingPeersToDisconnect.push(id);
      peersToDisconnectCount++;
    }

    peersToDisconnect.set(ExcessPeerDisconnectReason.FIND_BETTER_PEERS, remainingPeersToDisconnect);
  }
}

/**
 * Sort peers ascending, peer-0 has the most chance to prune, peer-n has the least.
 * Shuffling first to break ties.
 * prefer sorting by status score (applicable during syncing), then dutied subnets, then number of long lived subnets, then peer score
 * peer score is the last criteria since they are supposed to be in the same score range,
 * bad score peers are removed by peer manager anyway
 */
export function sortPeersToPrune(connectedPeers: PeerInfo[], dutiesByPeer: Map<PeerInfo, number>): PeerInfo[] {
  return shuffle(connectedPeers).sort((p1, p2) => {
    const dutiedSubnet1 = dutiesByPeer.get(p1) ?? 0;
    const dutiedSubnet2 = dutiesByPeer.get(p2) ?? 0;
    if (dutiedSubnet1 === dutiedSubnet2) {
      const statusScore = p1.statusScore - p2.statusScore;
      if (statusScore !== 0) {
        return statusScore;
      }
      const [longLivedSubnets1, longLivedSubnets2] = [p1, p2].map(
        (p) => p.attnetsTrueBitIndices.length + p.syncnetsTrueBitIndices.length
      );
      if (longLivedSubnets1 === longLivedSubnets2) {
        return p1.score - p2.score;
      }
      return longLivedSubnets1 - longLivedSubnets2;
    }
    return dutiedSubnet1 - dutiedSubnet2;
  });
}

/**
 * Find subnet that has the most peers and > TARGET_SUBNET_PEERS, return null if peers are not grouped
 * to any subnets.
 */
function findMaxPeersSubnet(subnetToPeers: Map<number, PeerInfo[]>, targetSubnetPeers: number): SubnetID | null {
  let maxPeersSubnet: SubnetID | null = null;
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
  targetSubnetPeers: number,
  activeAttnets: RequestedSubnet[]
): PeerInfo | null {
  const peersOnSubnet = sortBy(peersOnMostGroupedSubnet, (peer) => peer.attnetsTrueBitIndices.length);
  let removedPeer: PeerInfo | null = null;
  for (const candidatePeer of peersOnSubnet) {
    // new logic of lodestar
    const attnetIndices = candidatePeer.attnetsTrueBitIndices;
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
      if (minAttnetCount <= targetSubnetPeers) {
        continue;
      }
    }

    // same logic to lighthouse
    const syncnetIndices = candidatePeer.syncnetsTrueBitIndices;
    // The peer is subscribed to some long-lived sync-committees
    if (syncnetIndices.length > 0) {
      const minSubnetCount = Math.min(...syncnetIndices.map((subnet) => syncCommitteePeerCount.get(subnet) ?? 0));
      // If the minimum count is our target or lower, we
      // shouldn't remove this peer, because it drops us lower
      // than our target
      if (minSubnetCount <= MIN_SYNC_COMMITTEE_PEERS) {
        continue;
      }
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
