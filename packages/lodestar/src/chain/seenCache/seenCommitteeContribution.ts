import {Slot, ValidatorIndex} from "@chainsafe/lodestar-types";
import {MapDef} from "../../util/map";

/**
 * SyncCommittee aggregates are only useful for the next block they have signed.
 */
const MAX_SLOTS_IN_CACHE = 8;

/** AggregatorSubnetKey = `aggregatorIndex + subcommitteeIndex` */
type AggregatorSubnetKey = string;

/**
 * Cache SyncCommitteeContribution and seen ContributionAndProof.
 * This is used for SignedContributionAndProof validation and block factory.
 * This stays in-memory and should be pruned per slot.
 */
export class SeenContributionAndProof {
  private readonly seenCacheBySlot = new MapDef<Slot, Set<AggregatorSubnetKey>>(() => new Set<AggregatorSubnetKey>());

  /**
   * Gossip validation requires to check:
   * The sync committee contribution is the first valid contribution received for the aggregator with index
   * contribution_and_proof.aggregator_index for the slot contribution.slot and subcommittee index contribution.subcommittee_index.
   */
  isKnown(slot: Slot, subcommitteeIndex: number, aggregatorIndex: ValidatorIndex): boolean {
    return this.seenCacheBySlot.get(slot)?.has(seenCacheKey(subcommitteeIndex, aggregatorIndex)) === true;
  }

  /** Register item as seen in the cache */
  add(slot: Slot, subcommitteeIndex: number, aggregatorIndex: ValidatorIndex): void {
    this.seenCacheBySlot.getOrDefault(slot).add(seenCacheKey(subcommitteeIndex, aggregatorIndex));
  }

  /** Prune per head slot */
  prune(headSlot: Slot): void {
    for (const slot of this.seenCacheBySlot.keys()) {
      if (slot < headSlot - MAX_SLOTS_IN_CACHE) {
        this.seenCacheBySlot.delete(slot);
      }
    }
  }
}

function seenCacheKey(subcommitteeIndex: number, aggregatorIndex: ValidatorIndex): AggregatorSubnetKey {
  return `${subcommitteeIndex}-${aggregatorIndex}`;
}
