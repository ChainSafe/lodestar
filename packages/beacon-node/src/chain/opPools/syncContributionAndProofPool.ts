import {Signature, aggregateSignatures} from "@chainsafe/blst";
import {BitArray} from "@chainsafe/ssz";
import {SYNC_COMMITTEE_SIZE, SYNC_COMMITTEE_SUBNET_SIZE} from "@lodestar/params";
import {G2_POINT_AT_INFINITY} from "@lodestar/state-transition";
import {Root, Slot, SubnetID, altair, ssz} from "@lodestar/types";
import {Logger, MapDef, toRootHex} from "@lodestar/utils";
import {MAXIMUM_GOSSIP_CLOCK_DISPARITY} from "../../constants/constants.js";
import {Metrics} from "../../metrics/metrics.js";
import {IClock} from "../../util/clock.js";
import {InsertOutcome, OpPoolError, OpPoolErrorCode} from "./types.js";
import {pruneBySlot, signatureFromBytesNoCheck} from "./utils.js";

/**
 * SyncCommittee aggregates are only useful for the next block they have signed.
 */
const SLOTS_RETAINED = 8;

/**
 * The maximum number of distinct `SyncAggregateFast` that will be stored in each slot.
 *
 * This is a DoS protection measure.
 */
const MAX_ITEMS_PER_SLOT = 512;

// SyncContributionAndProofPool constructor ensures SYNC_COMMITTEE_SUBNET_SIZE is multiple of 8
const SYNC_COMMITTEE_SUBNET_BYTES = SYNC_COMMITTEE_SUBNET_SIZE / 8;

/**
 * A one-one mapping to SyncContribution with fast data structure to help speed up the aggregation.
 */
export type SyncContributionFast = {
  syncSubcommitteeBits: BitArray;
  numParticipants: number;
  syncSubcommitteeSignature: Uint8Array;
};

/** Hex string of `contribution.beaconBlockRoot` */
type BlockRootHex = string;

/**
 * Cache SyncCommitteeContribution and seen ContributionAndProof.
 * This is used for SignedContributionAndProof validation and block factory.
 * This stays in-memory and should be pruned per slot.
 */
export class SyncContributionAndProofPool {
  private readonly bestContributionBySubnetRootBySlot = new MapDef<
    Slot,
    MapDef<BlockRootHex, Map<SubnetID, SyncContributionFast>>
  >(() => new MapDef<BlockRootHex, Map<SubnetID, SyncContributionFast>>(() => new Map<number, SyncContributionFast>()));

  private lowestPermissibleSlot = 0;

  constructor(
    private readonly clock: IClock,
    private readonly metrics: Metrics | null = null,
    private logger: Logger | null = null
  ) {
    // Param guarantee for optimizations below that merge syncSubcommitteeBits as bytes
    if (SYNC_COMMITTEE_SUBNET_SIZE % 8 !== 0) {
      throw Error("SYNC_COMMITTEE_SUBNET_SIZE must be multiple of 8");
    }
    metrics?.opPool.syncContributionAndProofPool.size.addCollect(() => this.onScrapeMetrics(metrics));
  }

  /** Returns current count of unique SyncContributionFast by block root and subnet */
  get size(): number {
    let count = 0;
    for (const bestContributionByRootBySubnet of this.bestContributionBySubnetRootBySlot.values()) {
      for (const bestContributionByRoot of bestContributionByRootBySubnet.values()) {
        count += bestContributionByRoot.size;
      }
    }
    return count;
  }

  /**
   * Only call this once we pass all validation.
   */
  add(
    contributionAndProof: altair.ContributionAndProof,
    syncCommitteeParticipants: number,
    priority?: boolean
  ): InsertOutcome {
    const {contribution} = contributionAndProof;
    const {slot, beaconBlockRoot} = contribution;
    const rootHex = toRootHex(beaconBlockRoot);

    // Reject if too old.
    if (slot < this.lowestPermissibleSlot) {
      return InsertOutcome.Old;
    }

    // Reject ContributionAndProofs of previous slots
    // for api ContributionAndProofs, we allow them to be added to the pool
    if (!priority && slot < this.clock.slotWithPastTolerance(MAXIMUM_GOSSIP_CLOCK_DISPARITY)) {
      return InsertOutcome.Late;
    }

    // Limit object per slot
    const bestContributionBySubnetByRoot = this.bestContributionBySubnetRootBySlot.getOrDefault(slot);
    if (bestContributionBySubnetByRoot.size >= MAX_ITEMS_PER_SLOT) {
      throw new OpPoolError({code: OpPoolErrorCode.REACHED_MAX_PER_SLOT});
    }

    const bestContributionBySubnet = bestContributionBySubnetByRoot.getOrDefault(rootHex);
    const subnet = contribution.subcommitteeIndex;
    const bestContribution = bestContributionBySubnet.get(subnet);
    if (bestContribution) {
      return replaceIfBetter(bestContribution, contribution, syncCommitteeParticipants);
    }
    bestContributionBySubnet.set(subnet, contributionToFast(contribution, syncCommitteeParticipants));
    return InsertOutcome.NewData;
  }

  /**
   * This is for producing blocks, the same to process_sync_committee_contributions in the spec.
   */
  getAggregate(slot: Slot, prevBlockRoot: Root): altair.SyncAggregate {
    const opPoolMetrics = this.metrics?.opPool.syncContributionAndProofPool;
    const bestContributionBySubnetByRoot = this.bestContributionBySubnetRootBySlot.getOrDefault(slot);
    opPoolMetrics?.getAggregateRoots.set(bestContributionBySubnetByRoot.size);
    const prevBlockRootHex = toRootHex(prevBlockRoot);
    const bestContributionBySubnet = bestContributionBySubnetByRoot.getOrDefault(prevBlockRootHex);
    opPoolMetrics?.getAggregateSubnets.set(bestContributionBySubnet.size);

    if (bestContributionBySubnet.size === 0) {
      opPoolMetrics?.getAggregateReturnsEmpty.inc();
      // this may happen, see https://github.com/ChainSafe/lodestar/issues/7299
      const availableRoots = Array.from(bestContributionBySubnetByRoot.keys()).join(",");
      this.logger?.warn("SyncContributionAndProofPool.getAggregate: no contributions for root", {
        slot,
        root: prevBlockRootHex,
        availableRoots,
      });
      // Must return signature as G2_POINT_AT_INFINITY when participating bits are empty
      // https://github.com/ethereum/consensus-specs/blob/30f2a076377264677e27324a8c3c78c590ae5e20/specs/altair/bls.md#eth2_fast_aggregate_verify
      return {
        syncCommitteeBits: ssz.altair.SyncCommitteeBits.defaultValue(),
        syncCommitteeSignature: G2_POINT_AT_INFINITY,
      };
    }

    return aggregate(bestContributionBySubnet, this.metrics);
  }

  /**
   * Prune per head slot.
   * SyncCommittee aggregates are only useful for the next block they have signed.
   * We don't want to prune by clock slot in case there's a long period of skipped slots.
   */
  prune(headSlot: Slot): void {
    pruneBySlot(this.bestContributionBySubnetRootBySlot, headSlot, SLOTS_RETAINED);
    this.lowestPermissibleSlot = Math.max(headSlot - SLOTS_RETAINED, 0);
  }

  private onScrapeMetrics(metrics: Metrics): void {
    const poolMetrics = metrics.opPool.syncContributionAndProofPool;
    poolMetrics.size.set(this.size);
    const previousSlot = this.clock.currentSlot - 1;
    const contributionBySubnetByBlockRoot = this.bestContributionBySubnetRootBySlot.getOrDefault(previousSlot);
    poolMetrics.blockRootsPerSlot.set(contributionBySubnetByBlockRoot.size);
    let index = 0;
    for (const contributionsBySubnet of contributionBySubnetByBlockRoot.values()) {
      let participationCount = 0;
      for (const contribution of contributionsBySubnet.values()) {
        participationCount += contribution.numParticipants;
      }
      poolMetrics.subnetsByBlockRoot.set({index}, contributionsBySubnet.size);
      poolMetrics.participantsByBlockRoot.set({index}, participationCount);
      index++;
    }
  }
}

/**
 * Mutate bestContribution if new contribution has more participants
 */
export function replaceIfBetter(
  bestContribution: SyncContributionFast,
  newContribution: altair.SyncCommitteeContribution,
  newNumParticipants: number
): InsertOutcome {
  const {numParticipants} = bestContribution;

  if (newNumParticipants <= numParticipants) {
    return InsertOutcome.NotBetterThan;
  }

  bestContribution.syncSubcommitteeBits = newContribution.aggregationBits;
  bestContribution.numParticipants = newNumParticipants;
  bestContribution.syncSubcommitteeSignature = newContribution.signature;
  return InsertOutcome.NewData;
}

/**
 * Format `contribution` into an efficient data structure to aggregate later.
 */
export function contributionToFast(
  contribution: altair.SyncCommitteeContribution,
  numParticipants: number
): SyncContributionFast {
  return {
    // No need to clone, aggregationBits are not mutated, only replaced
    syncSubcommitteeBits: contribution.aggregationBits,
    numParticipants,
    // No need to deserialize, signatures are not aggregated until when calling .getAggregate()
    syncSubcommitteeSignature: contribution.signature,
  };
}

/**
 * Aggregate best contributions of each subnet into SyncAggregate
 * @returns SyncAggregate to be included in block body.
 */
export function aggregate(
  bestContributionBySubnet: Map<number, SyncContributionFast>,
  metrics: Metrics | null = null
): altair.SyncAggregate {
  // check for empty/undefined bestContributionBySubnet earlier
  const syncCommitteeBits = BitArray.fromBitLen(SYNC_COMMITTEE_SIZE);

  const signatures: Signature[] = [];
  let participationCount = 0;
  for (const [subnet, bestContribution] of bestContributionBySubnet.entries()) {
    participationCount += bestContribution.numParticipants;
    const byteOffset = subnet * SYNC_COMMITTEE_SUBNET_BYTES;

    for (let i = 0; i < SYNC_COMMITTEE_SUBNET_BYTES; i++) {
      syncCommitteeBits.uint8Array[byteOffset + i] = bestContribution.syncSubcommitteeBits.uint8Array[i];
    }

    signatures.push(signatureFromBytesNoCheck(bestContribution.syncSubcommitteeSignature));
  }

  metrics?.opPool.syncContributionAndProofPool.getAggregateParticipants.set(participationCount);
  return {
    syncCommitteeBits,
    syncCommitteeSignature: aggregateSignatures(signatures).toBytes(),
  };
}
