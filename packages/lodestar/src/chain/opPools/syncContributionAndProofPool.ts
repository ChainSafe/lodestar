import bls, {PointFormat, Signature} from "@chainsafe/bls";
import {SYNC_COMMITTEE_SIZE, SYNC_COMMITTEE_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {phase0, altair, Slot, ssz, ValidatorIndex} from "@chainsafe/lodestar-types";
import {newFilledArray, G2_POINT_AT_INFINITY} from "@chainsafe/lodestar-beacon-state-transition";
import {readonlyValues, toHexString} from "@chainsafe/ssz";
import {MapDef} from "../../util/map";
import {InsertOutcome, OpPoolError, OpPoolErrorCode} from "./types";
import {pruneBySlot} from "./utils";

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

type SyncAggregateFast = {
  syncCommitteeBits: boolean[];
  syncCommitteeSignature: Signature;
};

/** Hex string of `contribution.beaconBlockRoot` */
type BlockRootHex = string;

/**
 * Cache SyncCommitteeContribution and seen ContributionAndProof.
 * This is used for SignedContributionAndProof validation and block factory.
 * This stays in-memory and should be pruned per slot.
 */
export class SyncContributionAndProofPool {
  private readonly aggregateByRootBySlot = new MapDef<phase0.Slot, Map<BlockRootHex, SyncAggregateFast>>(
    () => new Map<BlockRootHex, SyncAggregateFast>()
  );
  private lowestPermissibleSlot = 0;

  /**
   * Only call this once we pass all validation.
   */
  add(contributionAndProof: altair.ContributionAndProof): InsertOutcome {
    const {contribution} = contributionAndProof;
    const {slot, beaconBlockRoot} = contribution;
    const rootHex = toHexString(beaconBlockRoot);
    const lowestPermissibleSlot = this.lowestPermissibleSlot;

    // Reject if too old.
    if (slot < lowestPermissibleSlot) {
      throw new OpPoolError({code: OpPoolErrorCode.SLOT_TOO_LOW, slot, lowestPermissibleSlot});
    }

    // Limit object per slot
    const aggregateByRoot = this.aggregateByRootBySlot.getOrDefault(slot);
    if (aggregateByRoot.size >= MAX_ITEMS_PER_SLOT) {
      throw new OpPoolError({code: OpPoolErrorCode.REACHED_MAX_PER_SLOT});
    }

    // Pre-aggregate the contribution with existing items
    const aggregate = aggregateByRoot.get(rootHex);
    if (aggregate) {
      // Aggregate mutating
      return aggregateContributionInto(aggregate, contribution);
    } else {
      // Create new aggregate
      aggregateByRoot.set(rootHex, contributionToAggregate(contribution));
      return InsertOutcome.NewData;
    }
  }

  /**
   * This is for the block factory, the same to process_sync_committee_contributions in the spec.
   */
  getAggregate(slot: phase0.Slot, prevBlockRoot: phase0.Root): altair.SyncAggregate {
    const aggregate = this.aggregateByRootBySlot.get(slot)?.get(toHexString(prevBlockRoot));
    if (!aggregate) {
      // TODO: Add metric for missing SyncAggregate
      // Must return signature as G2_POINT_AT_INFINITY when participating bits are empty
      // https://github.com/ethereum/eth2.0-specs/blob/30f2a076377264677e27324a8c3c78c590ae5e20/specs/altair/bls.md#eth2_fast_aggregate_verify
      return {
        syncCommitteeBits: ssz.altair.SyncCommitteeBits.defaultValue(),
        syncCommitteeSignature: G2_POINT_AT_INFINITY,
      };
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
    pruneBySlot(this.aggregateByRootBySlot, headSlot, SLOTS_RETAINED);
    this.lowestPermissibleSlot = Math.max(headSlot - SLOTS_RETAINED, 0);
  }
}

/**
 * Aggregate a new contribution into `aggregate` mutating it
 */
function aggregateContributionInto(
  aggregate: SyncAggregateFast,
  contribution: altair.SyncCommitteeContribution
): InsertOutcome {
  const indexesPerSubnet = Math.floor(SYNC_COMMITTEE_SIZE / SYNC_COMMITTEE_SUBNET_COUNT);
  const indexOffset = indexesPerSubnet * contribution.subCommitteeIndex;

  const syncCommitteeIndices: ValidatorIndex[] = [];
  for (const [index, participated] of Array.from(readonlyValues(contribution.aggregationBits)).entries()) {
    if (participated) {
      const syncCommitteeIndex = indexOffset + index;
      if (aggregate.syncCommitteeBits[syncCommitteeIndex] === true) {
        return InsertOutcome.AlreadyKnown;
      }
      syncCommitteeIndices.push(syncCommitteeIndex);
    }
  }

  for (const syncCommitteeIndex of syncCommitteeIndices) {
    aggregate.syncCommitteeBits[syncCommitteeIndex] = true;
  }

  aggregate.syncCommitteeSignature = Signature.aggregate([
    aggregate.syncCommitteeSignature,
    bls.Signature.fromBytes(contribution.signature.valueOf() as Uint8Array),
  ]);
  return InsertOutcome.Aggregated;
}

/**
 * Format `contribution` into an efficient `aggregate` to add more contributions in with aggregateContributionInto()
 */
function contributionToAggregate(contribution: altair.SyncCommitteeContribution): SyncAggregateFast {
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
