import bls, {PointFormat, Signature} from "@chainsafe/bls";
import {SYNC_COMMITTEE_SIZE, SYNC_COMMITTEE_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {newFilledArray} from "@chainsafe/lodestar-beacon-state-transition";
import {altair, Root, Slot, SubCommitteeIndex} from "@chainsafe/lodestar-types";
import {BitList, toHexString} from "@chainsafe/ssz";
import {MapDef} from "../../util/map";
import {InsertOutcome, OpPoolError, OpPoolErrorCode} from "./types";
import {pruneBySlot} from "./utils";

/**
 * SyncCommittee signatures are only useful during a single slot according to our peer's clocks
 */
const SLOTS_RETAINED = 3;

/**
 * The maximum number of distinct `ContributionFast` that will be stored in each slot.
 *
 * This is a DoS protection measure.
 */
const MAX_ITEMS_PER_SLOT = 512;

type ContributionFast = Omit<altair.SyncCommitteeContribution, "aggregationBits" | "signature"> & {
  aggregationBits: boolean[];
  signature: Signature;
};

/** Hex string of `contribution.beaconBlockRoot` */
type BlockRootHex = string;
type Subnet = SubCommitteeIndex;

/**
 * Preaggregate SyncCommitteeMessage into SyncCommitteeContribution
 * and cache seen SyncCommitteeMessage by slot + validator index.
 * This stays in-memory and should be pruned per slot.
 */
export class SyncCommitteeMessagePool {
  /**
   * Each array item is respective to a subCommitteeIndex.
   * Preaggregate into SyncCommitteeContribution.
   * */
  private readonly contributionsByRootBySubnetBySlot = new MapDef<
    Slot,
    MapDef<Subnet, Map<BlockRootHex, ContributionFast>>
  >(() => new MapDef<Subnet, Map<BlockRootHex, ContributionFast>>(() => new Map<BlockRootHex, ContributionFast>()));
  private lowestPermissibleSlot = 0;

  // TODO: indexInSubCommittee: number should be indicesInSyncCommittee
  add(subnet: Subnet, signature: altair.SyncCommitteeMessage, indexInSubCommittee: number): InsertOutcome {
    const {slot, beaconBlockRoot} = signature;
    const rootHex = toHexString(beaconBlockRoot);
    const lowestPermissibleSlot = this.lowestPermissibleSlot;

    // Reject if too old.
    if (slot < lowestPermissibleSlot) {
      throw new OpPoolError({code: OpPoolErrorCode.SLOT_TOO_LOW, slot, lowestPermissibleSlot});
    }

    // Limit object per slot
    const contributionsByRoot = this.contributionsByRootBySubnetBySlot.getOrDefault(slot).getOrDefault(subnet);
    if (contributionsByRoot.size >= MAX_ITEMS_PER_SLOT) {
      throw new OpPoolError({code: OpPoolErrorCode.REACHED_MAX_PER_SLOT});
    }

    // Pre-aggregate the contribution with existing items
    const contribution = contributionsByRoot.get(rootHex);
    if (contribution) {
      // Aggregate mutating
      return aggregateSignatureInto(contribution, signature, indexInSubCommittee);
    } else {
      // Create new aggregate
      contributionsByRoot.set(rootHex, signatureToAggregate(subnet, signature, indexInSubCommittee));
      return InsertOutcome.NewData;
    }
  }

  /**
   * This is for the aggregator to produce ContributionAndProof.
   */
  getContribution(subnet: SubCommitteeIndex, slot: Slot, prevBlockRoot: Root): altair.SyncCommitteeContribution | null {
    const contribution = this.contributionsByRootBySubnetBySlot.get(slot)?.get(subnet)?.get(toHexString(prevBlockRoot));
    if (!contribution) {
      return null;
    }

    return {
      ...contribution,
      aggregationBits: contribution.aggregationBits as BitList,
      signature: contribution.signature.toBytes(PointFormat.compressed),
    };
  }

  /**
   * Prune per clock slot.
   * SyncCommittee signatures are only useful during a single slot according to our peer's clocks
   */
  prune(clockSlot: Slot): void {
    pruneBySlot(this.contributionsByRootBySubnetBySlot, clockSlot, SLOTS_RETAINED);
    this.lowestPermissibleSlot = Math.max(clockSlot - SLOTS_RETAINED, 0);
  }
}

/**
 * Aggregate a new signature into `contribution` mutating it
 */
function aggregateSignatureInto(
  contribution: ContributionFast,
  signature: altair.SyncCommitteeMessage,
  indexInSubCommittee: number
): InsertOutcome {
  if (contribution.aggregationBits[indexInSubCommittee] === true) {
    return InsertOutcome.AlreadyKnown;
  }

  contribution.aggregationBits[indexInSubCommittee] = true;

  contribution.signature = Signature.aggregate([
    contribution.signature,
    bls.Signature.fromBytes(signature.signature.valueOf() as Uint8Array, undefined, true),
  ]);
  return InsertOutcome.Aggregated;
}

/**
 * Format `signature` into an efficient `contribution` to add more signatures in with aggregateSignatureInto()
 */
function signatureToAggregate(
  subnet: number,
  signature: altair.SyncCommitteeMessage,
  indexInSubCommittee: number
): ContributionFast {
  const indexesPerSubnet = Math.floor(SYNC_COMMITTEE_SIZE / SYNC_COMMITTEE_SUBNET_COUNT);
  const aggregationBits = newFilledArray(indexesPerSubnet, false);
  aggregationBits[indexInSubCommittee] = true;

  return {
    slot: signature.slot,
    beaconBlockRoot: signature.beaconBlockRoot,
    subCommitteeIndex: subnet,
    aggregationBits,
    signature: bls.Signature.fromBytes(signature.signature.valueOf() as Uint8Array, undefined, true),
  };
}
