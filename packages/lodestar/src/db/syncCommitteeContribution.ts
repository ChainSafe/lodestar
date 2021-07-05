import bls, {PointFormat, Signature} from "@chainsafe/bls";
import {SYNC_COMMITTEE_SIZE, SYNC_COMMITTEE_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0, altair, Slot, ssz} from "@chainsafe/lodestar-types";
import {newFilledArray} from "@chainsafe/lodestar-beacon-state-transition";
import {readonlyValues, toHexString} from "@chainsafe/ssz";
import {LodestarError} from "@chainsafe/lodestar-utils";

/**
 * SyncCommittee aggregates are only useful for the next block they have signed.
 */
const MAX_SLOTS_IN_CACHE = 8;

type SyncAggregateFast = {
  syncCommitteeBits: boolean[];
  syncCommitteeSignature: Signature;
};

/** AggregatorSubnetKey = `aggregatorIndex + subCommitteeIndex` */
type AggregatorSubnetKey = string;
/** Hex string of `contribution.beaconBlockRoot` */
type BlockRootHex = string;

/**
 * Cache SyncCommitteeContribution and seen ContributionAndProof.
 * This is used for SignedContributionAndProof validation and block factory.
 * This stays in-memory and should be pruned per slot.
 */
export class SyncCommitteeContributionCache {
  private readonly aggregateByRootBySlot = new Map<phase0.Slot, Map<BlockRootHex, SyncAggregateFast>>();
  private readonly seenCacheBySlot = new Map<phase0.Slot, Set<AggregatorSubnetKey>>();

  constructor(private readonly config: IBeaconConfig) {}

  /** Register item as seen in the cache */
  seen(contributionAndProof: altair.ContributionAndProof): void {
    const slot = contributionAndProof.contribution.slot;
    let seenCache = this.seenCacheBySlot.get(slot);
    if (!seenCache) {
      seenCache = new Set<AggregatorSubnetKey>();
      this.seenCacheBySlot.set(slot, seenCache);
    }
    seenCache.add(seenCacheKey(contributionAndProof));
  }

  /**
   * Only call this once we pass all validation.
   */
  add(contributionAndProof: altair.ContributionAndProof): void {
    const {contribution} = contributionAndProof;
    const {slot, beaconBlockRoot} = contribution;
    const rootHex = toHexString(beaconBlockRoot);

    // Pre-aggregate the contribution with existing items
    let aggregateByRoot = this.aggregateByRootBySlot.get(slot);
    if (!aggregateByRoot) {
      aggregateByRoot = new Map<BlockRootHex, SyncAggregateFast>();
      this.aggregateByRootBySlot.set(slot, aggregateByRoot);
    }
    const aggregate = aggregateByRoot.get(rootHex);
    if (aggregate) {
      // Aggregate mutating
      aggregateContributionInto(this.config, aggregate, contribution);
    } else {
      // Create new aggregate
      aggregateByRoot.set(rootHex, contributionToAggregate(this.config, contribution));
    }

    // Mark this item as seen for has()
    this.seen(contributionAndProof);
  }

  /**
   * Gossip validation requires to check:
   * The sync committee contribution is the first valid contribution received for the aggregator with index
   * contribution_and_proof.aggregator_index for the slot contribution.slot and subcommittee index contribution.subcommittee_index.
   */
  has(contributionAndProof: altair.ContributionAndProof): boolean {
    const slot = contributionAndProof.contribution.slot;
    return this.seenCacheBySlot.get(slot)?.has(seenCacheKey(contributionAndProof)) === true;
  }

  /**
   * This is for the block factory, the same to process_sync_committee_contributions in the spec.
   */
  getSyncAggregate(slot: phase0.Slot, prevBlockRoot: phase0.Root): altair.SyncAggregate {
    const aggregate = this.aggregateByRootBySlot.get(slot)?.get(toHexString(prevBlockRoot));
    if (!aggregate) {
      // TODO: Add metric for missing SyncAggregate
      return ssz.altair.SyncAggregate.defaultValue();
    }

    return {
      syncCommitteeBits: aggregate.syncCommitteeBits,
      syncCommitteeSignature: aggregate.syncCommitteeSignature.toBytes(PointFormat.compressed),
    };
  }

  /**
   * Prune per head slot.
   * SyncCommittee aggregates are only useful for the next block they have signed.
   * We don't want to prune by clock slot in case there's a long period of skipped slots.
   */
  prune(headSlot: Slot): void {
    for (const slot of this.aggregateByRootBySlot.keys()) {
      if (slot < headSlot - MAX_SLOTS_IN_CACHE) {
        this.aggregateByRootBySlot.delete(slot);
      }
    }

    for (const slot of this.seenCacheBySlot.keys()) {
      if (slot < headSlot - MAX_SLOTS_IN_CACHE) {
        this.seenCacheBySlot.delete(slot);
      }
    }
  }
}

export enum SyncContributionErrorCode {
  ALREADY_KNOWN = "SYNC_COMMITTEE_CONTRIBUTION_ERROR_ALREADY_KNOWN",
}

type SyncContributionErrorType = {
  code: SyncContributionErrorCode.ALREADY_KNOWN;
  syncCommitteeIndex: number;
  slot: Slot;
};

export class SyncContributionError extends LodestarError<SyncContributionErrorType> {}

/**
 * Aggregate a new contribution into `aggregate` mutating it
 */
function aggregateContributionInto(
  config: IBeaconConfig,
  aggregate: SyncAggregateFast,
  contribution: altair.SyncCommitteeContribution
): void {
  const indexesPerSubnet = Math.floor(SYNC_COMMITTEE_SIZE / SYNC_COMMITTEE_SUBNET_COUNT);
  const indexOffset = indexesPerSubnet * contribution.subCommitteeIndex;

  for (const [index, participated] of Array.from(readonlyValues(contribution.aggregationBits)).entries()) {
    if (participated) {
      const syncCommitteeIndex = indexOffset + index;
      if (aggregate.syncCommitteeBits[syncCommitteeIndex] === true) {
        throw new SyncContributionError({
          code: SyncContributionErrorCode.ALREADY_KNOWN,
          syncCommitteeIndex,
          slot: contribution.slot,
        });
      }

      aggregate.syncCommitteeBits[syncCommitteeIndex] = true;
    }
  }

  aggregate.syncCommitteeSignature = Signature.aggregate([
    aggregate.syncCommitteeSignature,
    bls.Signature.fromBytes(contribution.signature.valueOf() as Uint8Array),
  ]);
}

/**
 * Format `contribution` into an efficient `aggregate` to add more contributions in with aggregateContributionInto()
 */
function contributionToAggregate(
  config: IBeaconConfig,
  contribution: altair.SyncCommitteeContribution
): SyncAggregateFast {
  const indexesPerSubnet = Math.floor(SYNC_COMMITTEE_SIZE / SYNC_COMMITTEE_SUBNET_COUNT);
  const indexOffset = indexesPerSubnet * contribution.subCommitteeIndex;

  const syncCommitteeBits = newFilledArray(SYNC_COMMITTEE_SIZE, false);
  for (const [index, participated] of Array.from(readonlyValues(contribution.aggregationBits)).entries()) {
    if (participated) {
      syncCommitteeBits[indexOffset + index] = true;
    }
  }

  return {
    syncCommitteeBits,
    syncCommitteeSignature: bls.Signature.fromBytes(contribution.signature.valueOf() as Uint8Array),
  };
}

function seenCacheKey(contributionAndProof: altair.ContributionAndProof): AggregatorSubnetKey {
  const {aggregatorIndex, contribution} = contributionAndProof;
  const {subCommitteeIndex} = contribution;
  return `${aggregatorIndex}-${subCommitteeIndex}`;
}
