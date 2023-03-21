import {Slot, ValidatorIndex} from "@lodestar/types";
import {ContributionAndProof, SyncCommitteeContribution} from "@lodestar/types/altair";
import {MapDef} from "@lodestar/utils";
import {toHexString} from "@chainsafe/ssz";
import {Metrics} from "../../metrics/index.js";
import {isSuperSetOrEqual} from "../../util/bitArray.js";
import {AggregationInfo, insertDesc} from "./seenAggregateAndProof.js";

/**
 * SyncCommittee aggregates are only useful for the next block they have signed.
 */
const MAX_SLOTS_IN_CACHE = 8;

/** AggregatorSubnetKey = `aggregatorIndex + subcommitteeIndex` */
type AggregatorSubnetKey = string;

/** ContributionDataKey = `slot + beacon_block_root + subcommittee_index */
type ContributionDataKey = string;

/**
 * Cache SyncCommitteeContribution and seen ContributionAndProof.
 * This is used for SignedContributionAndProof validation and block factory.
 * This stays in-memory and should be pruned per slot.
 */
export class SeenContributionAndProof {
  private readonly seenAggregatorBySlot = new MapDef<Slot, Set<AggregatorSubnetKey>>(
    () => new Set<AggregatorSubnetKey>()
  );

  private readonly seenContributionBySlot = new MapDef<Slot, MapDef<ContributionDataKey, AggregationInfo[]>>(
    () => new MapDef(() => [])
  );

  constructor(private readonly metrics: Metrics | null) {}

  /**
   * _[IGNORE]_ A valid sync committee contribution with equal `slot`, `beacon_block_root` and `subcommittee_index` whose
   * `aggregation_bits` is non-strict superset has _not_ already been seen.
   */
  participantsKnown(contribution: SyncCommitteeContribution): boolean {
    const {aggregationBits, slot} = contribution;
    const contributionMap = this.seenContributionBySlot.getOrDefault(slot);
    const seenAggregationInfoArr = contributionMap.getOrDefault(toContributionDataKey(contribution));
    this.metrics?.seenCache.committeeContributions.isKnownCalls.inc();
    // seenAttestingIndicesArr is sorted by trueBitCount desc

    for (let i = 0; i < seenAggregationInfoArr.length; i++) {
      if (isSuperSetOrEqual(seenAggregationInfoArr[i].aggregationBits, aggregationBits)) {
        this.metrics?.seenCache.committeeContributions.isKnownHits.inc();
        this.metrics?.seenCache.committeeContributions.superSetCheckTotal.observe(i + 1);
        return true;
      }
    }

    this.metrics?.seenCache.committeeContributions.superSetCheckTotal.observe(seenAggregationInfoArr.length);
    return false;
  }

  /**
   * Gossip validation requires to check:
   * The sync committee contribution is the first valid contribution received for the aggregator with index
   * contribution_and_proof.aggregator_index for the slot contribution.slot and subcommittee index contribution.subcommittee_index.
   */
  isAggregatorKnown(slot: Slot, subcommitteeIndex: number, aggregatorIndex: ValidatorIndex): boolean {
    return this.seenAggregatorBySlot.get(slot)?.has(seenAggregatorKey(subcommitteeIndex, aggregatorIndex)) === true;
  }

  /** Register item as seen in the cache */
  add(contributionAndProof: ContributionAndProof, trueBitCount: number): void {
    const {contribution, aggregatorIndex} = contributionAndProof;
    const {subcommitteeIndex, slot, aggregationBits} = contribution;

    // add to seenAggregatorBySlot
    this.seenAggregatorBySlot.getOrDefault(slot).add(seenAggregatorKey(subcommitteeIndex, aggregatorIndex));

    // add to seenContributionBySlot
    const contributionMap = this.seenContributionBySlot.getOrDefault(slot);
    const seenAggregationInfoArr = contributionMap.getOrDefault(toContributionDataKey(contribution));
    insertDesc(seenAggregationInfoArr, {aggregationBits, trueBitCount});
  }

  /** Prune per head slot */
  prune(headSlot: Slot): void {
    for (const slot of this.seenAggregatorBySlot.keys()) {
      if (slot < headSlot - MAX_SLOTS_IN_CACHE) {
        this.seenAggregatorBySlot.delete(slot);
      }
    }

    for (const slot of this.seenContributionBySlot.keys()) {
      if (slot < headSlot - MAX_SLOTS_IN_CACHE) {
        this.seenContributionBySlot.delete(slot);
      }
    }
  }
}

function seenAggregatorKey(subcommitteeIndex: number, aggregatorIndex: ValidatorIndex): AggregatorSubnetKey {
  return `${subcommitteeIndex}-${aggregatorIndex}`;
}

function toContributionDataKey(contribution: SyncCommitteeContribution): ContributionDataKey {
  const {slot, beaconBlockRoot, subcommitteeIndex} = contribution;
  return `${slot} - ${toHexString(beaconBlockRoot)} - ${subcommitteeIndex}`;
}
