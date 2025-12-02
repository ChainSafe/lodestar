import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Slot, SubnetID} from "@lodestar/types";
import {MapDef, pruneSetToMax} from "@lodestar/utils";

// Subscriptions are submitted max two epochs in advance
const MAX_SLOTS_CACHED = SLOTS_PER_EPOCH * 2;

/**
 * Track if there's at least one aggregator on tuple (subnet, slot),
 * to only then insert attestations into the op pool
 */
export class AggregatorTracker {
  private subnetAggregatorsBySlot = new MapDef<Slot, Set<SubnetID>>(() => new Set());

  get maxSlotsCached(): number {
    return MAX_SLOTS_CACHED;
  }

  addAggregator(subnet: SubnetID, slot: Slot): void {
    this.subnetAggregatorsBySlot.getOrDefault(slot).add(subnet);
  }

  shouldAggregate(subnet: SubnetID, slot: Slot): boolean {
    return this.subnetAggregatorsBySlot.get(slot)?.has(subnet) === true;
  }

  prune(): void {
    // We could also `pruneBySlot` as items before current slot are no longer
    // relevant but due to small cache size (64), the best approach is to
    // just prune the cache after a batch of subnet subscriptions is processed.
    pruneSetToMax(
      this.subnetAggregatorsBySlot,
      MAX_SLOTS_CACHED,
      // Prune the oldest slots first
      (a, b) => a - b
    );
  }
}
