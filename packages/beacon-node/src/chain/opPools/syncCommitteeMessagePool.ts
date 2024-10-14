import {BitArray} from "@chainsafe/ssz";
import {Signature, aggregateSignatures} from "@chainsafe/blst";
import {SYNC_COMMITTEE_SIZE, SYNC_COMMITTEE_SUBNET_COUNT} from "@lodestar/params";
import {altair, Root, Slot, SubcommitteeIndex} from "@lodestar/types";
import {MapDef, toRootHex} from "@lodestar/utils";
import {IClock} from "../../util/clock.js";
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
  signature: Signature;
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

  constructor(
    private readonly clock: IClock,
    private readonly cutOffSecFromSlot: number,
    private readonly preaggregateSlotDistance = 0
  ) {}

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
    const rootHex = toRootHex(beaconBlockRoot);
    const lowestPermissibleSlot = this.lowestPermissibleSlot;

    // Reject if too old.
    if (slot < lowestPermissibleSlot) {
      return InsertOutcome.Old;
    }

    // validator gets SyncCommitteeContribution at 2/3 of slot, it's no use to preaggregate later than that time
    if (this.clock.secFromSlot(slot) > this.cutOffSecFromSlot) {
      return InsertOutcome.Late;
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
    }

    // Create new aggregate
    contributionsByRoot.set(rootHex, signatureToAggregate(subnet, signature, indexInSubcommittee));
    return InsertOutcome.NewData;
  }

  /**
   * This is for the aggregator to produce ContributionAndProof.
   */
  getContribution(subnet: SubcommitteeIndex, slot: Slot, prevBlockRoot: Root): altair.SyncCommitteeContribution | null {
    const contribution = this.contributionsByRootBySubnetBySlot.get(slot)?.get(subnet)?.get(toRootHex(prevBlockRoot));
    if (!contribution) {
      return null;
    }

    return {
      ...contribution,
      aggregationBits: contribution.aggregationBits,
      signature: contribution.signature.toBytes(),
    };
  }

  /**
   * Prune per clock slot.
   * SyncCommittee signatures are only useful during a single slot according to our peer's clocks
   */
  prune(clockSlot: Slot): void {
    pruneBySlot(this.contributionsByRootBySubnetBySlot, clockSlot, SLOTS_RETAINED);
    // by default preaggregateSlotDistance is 0, i.e only accept SyncCommitteeMessage in the same clock slot.
    this.lowestPermissibleSlot = Math.max(clockSlot - this.preaggregateSlotDistance, 0);
  }
}

/**
 * Aggregate a new signature into `contribution` mutating it
 */
function aggregateSignatureInto(
  contribution: ContributionFast,
  signature: altair.SyncCommitteeMessage,
  indexInSubcommittee: number
): InsertOutcome {
  if (contribution.aggregationBits.get(indexInSubcommittee) === true) {
    return InsertOutcome.AlreadyKnown;
  }

  contribution.aggregationBits.set(indexInSubcommittee, true);
  contribution.signature = aggregateSignatures([
    contribution.signature,
    signatureFromBytesNoCheck(signature.signature),
  ]);
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
    signature: signatureFromBytesNoCheck(signature.signature),
  };
}
