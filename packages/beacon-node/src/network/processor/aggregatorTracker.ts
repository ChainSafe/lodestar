import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Slot} from "@lodestar/types";
import {MapDef, pruneSetToMax} from "@lodestar/utils";

type SubnetId = number;

// Subscriptions are submitted max two epochs in advance
const MAX_SLOTS_CACHED = SLOTS_PER_EPOCH * 2;

/**
 * Track if there's at least one aggregator on tuple (subnet, slot),
 * to only then insert attestations into the op pool
 */
export class AggregatorTracker {
  private subnetAggregatorsBySlot = new MapDef<Slot, Set<SubnetId>>(() => new Set());

  get maxSlotsCached(): number {
    return MAX_SLOTS_CACHED;
  }

  addAggregator(subnet: SubnetId, slot: Slot): void {
    this.subnetAggregatorsBySlot.getOrDefault(slot).add(subnet);
  }

  shouldAggregate(subnet: SubnetId, slot: Slot): boolean {
    return this.subnetAggregatorsBySlot.get(slot)?.has(subnet) === true;
  }

  prune(): void {
    pruneSetToMax(
      this.subnetAggregatorsBySlot,
      MAX_SLOTS_CACHED,
      // Prune the oldest slots first
      (a, b) => a - b
    );
  }
}
