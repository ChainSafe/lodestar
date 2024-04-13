import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Slot} from "@lodestar/types";
import {pruneSetToMax} from "@lodestar/utils";
import {OrderedMapDef} from "../../util/map.js";

type SubnetId = number;

// Subscriptions are submitted max two epochs in advance
const MAX_SLOTS_CACHED = SLOTS_PER_EPOCH * 2;

/**
 * Track if there's at least one aggregator on tuple (subnet, slot),
 * to only then insert attestations into the op pool
 */
export class AggregatorTracker {
  private subnetAggregatorsBySlot = new OrderedMapDef<Slot, Set<SubnetId>>(() => new Set());

  get maxSlotsCached(): number {
    return MAX_SLOTS_CACHED;
  }

  addAggregator(subnet: SubnetId, slot: Slot): void {
    this.subnetAggregatorsBySlot.getOrDefault(slot).add(subnet);

    pruneSetToMax(this.subnetAggregatorsBySlot, MAX_SLOTS_CACHED);
  }

  shouldAggregate(subnet: SubnetId, slot: Slot): boolean {
    return this.subnetAggregatorsBySlot.get(slot)?.has(subnet) === true;
  }
}
