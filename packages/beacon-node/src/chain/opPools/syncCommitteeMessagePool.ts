import {PointFormat} from "@chainsafe/bls/types";
import bls from "@chainsafe/bls";
import {SYNC_COMMITTEE_SIZE, SYNC_COMMITTEE_SUBNET_COUNT} from "@lodestar/params";
import {altair, Root, Slot, SubcommitteeIndex} from "@lodestar/types";
import {BitArray, toHexString} from "@chainsafe/ssz";
import {MapDef} from "@lodestar/utils";
import {InsertOutcome, OpPoolError, OpPoolErrorCode} from "./types.js";
import {pruneBySlot, signatureFromBytesNoCheck} from "./utils.js";

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
  aggregationBits: BitArray;
  /**
   * Two potential strategies to pre-aggregate sync committee signatures:
   * - Aggregate new signature into existing contribution on .add(). More memory efficient as only 1 signature
   *   is kept per contribution. However, the eager aggregation may be useless if the connected validator ends up
   *   not being an aggregator. bls.Signature.fromBytes() is not free, thus the aggregation may be done around
   *   the 1/3 of the slot which is a very busy period.
   * - Defer aggregation until getContribution(). Consumes more memory but prevents extra work by only doing the
   *   aggregation if the connected validator is an aggregator. The aggregation is done during 2/3 of the slot
   *   which is a less busy time than 1/3 of the slot.
   */
  signatures: Uint8Array[];
  /**
   * There could be up to TARGET_AGGREGATORS_PER_COMMITTEE aggregator per committee and all getContribution() call
   * tends to be at the same time so we want to cache the aggregated contribution, invalidate cache per new sync committee signature.
   */
  contribution: altair.SyncCommitteeContribution | null;
};

/** Hex string of `contribution.beaconBlockRoot` */
type BlockRootHex = string;
type Subnet = SubcommitteeIndex;

/**
 * Preaggregate SyncCommitteeMessage into SyncCommitteeContribution
 * and cache seen SyncCommitteeMessage by slot + validator index.
 * This stays in-memory and should be pruned per slot.
 */
export class SyncCommitteeMessagePool {
  /**
   * Each array item is respective to a subcommitteeIndex.
   * Preaggregate into SyncCommitteeContribution.
   * */
  private readonly contributionsByRootBySubnetBySlot = new MapDef<
    Slot,
    MapDef<Subnet, Map<BlockRootHex, ContributionFast>>
  >(() => new MapDef<Subnet, Map<BlockRootHex, ContributionFast>>(() => new Map<BlockRootHex, ContributionFast>()));
  private lowestPermissibleSlot = 0;

  /** Returns current count of unique ContributionFast by block root and subnet */
  get size(): number {
    let count = 0;
    for (const contributionsByRootBySubnet of this.contributionsByRootBySubnetBySlot.values()) {
      for (const contributionsByRoot of contributionsByRootBySubnet.values()) {
        count += contributionsByRoot.size;
      }
    }
    return count;
  }

  // TODO: indexInSubcommittee: number should be indicesInSyncCommittee
  add(subnet: Subnet, signature: altair.SyncCommitteeMessage, indexInSubcommittee: number): InsertOutcome {
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
      return aggregateSignatureInto(contribution, signature, indexInSubcommittee);
    } else {
      // Create new aggregate
      contributionsByRoot.set(rootHex, signatureToAggregate(subnet, signature, indexInSubcommittee));
      return InsertOutcome.NewData;
    }
  }

  /**
   * This is for the aggregator to produce ContributionAndProof.
   */
  getContribution(subnet: SubcommitteeIndex, slot: Slot, prevBlockRoot: Root): altair.SyncCommitteeContribution | null {
    const fastContribution = this.contributionsByRootBySubnetBySlot
      .get(slot)
      ?.get(subnet)
      ?.get(toHexString(prevBlockRoot));
    if (!fastContribution) {
      return null;
    }

    let contribution = fastContribution.contribution;
    if (contribution) return contribution;

    contribution = {
      ...fastContribution,
      aggregationBits: fastContribution.aggregationBits,
      signature: bls.Signature.aggregate(
        // No need to validate Signature again since it has already been validated --------------- false
        fastContribution.signatures.map((signature) => signatureFromBytesNoCheck(signature))
      ).toBytes(PointFormat.compressed),
    };
    fastContribution.contribution = contribution;

    return contribution;
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
  fastContribution: ContributionFast,
  signature: altair.SyncCommitteeMessage,
  indexInSubcommittee: number
): InsertOutcome {
  if (fastContribution.aggregationBits.get(indexInSubcommittee) === true) {
    return InsertOutcome.AlreadyKnown;
  }

  fastContribution.aggregationBits.set(indexInSubcommittee, true);
  fastContribution.signatures.push(signature.signature);
  fastContribution.contribution = null;

  return InsertOutcome.Aggregated;
}

/**
 * Format `signature` into an efficient `contribution` to add more signatures in with aggregateSignatureInto()
 */
function signatureToAggregate(
  subnet: number,
  signature: altair.SyncCommitteeMessage,
  indexInSubcommittee: number
): ContributionFast {
  const indexesPerSubnet = Math.floor(SYNC_COMMITTEE_SIZE / SYNC_COMMITTEE_SUBNET_COUNT);
  const aggregationBits = BitArray.fromSingleBit(indexesPerSubnet, indexInSubcommittee);

  return {
    slot: signature.slot,
    beaconBlockRoot: signature.beaconBlockRoot,
    subcommitteeIndex: subnet,
    aggregationBits,
    signatures: [signature.signature],
    contribution: null,
  };
}
