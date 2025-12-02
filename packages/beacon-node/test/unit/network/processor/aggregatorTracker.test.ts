import {beforeEach, describe, expect, it} from "vitest";
import {AggregatorTracker} from "../../../../src/network/processor/aggregatorTracker.js";

describe("AggregatorTracker", () => {
  let aggregatorTracker: AggregatorTracker;

  beforeEach(() => {
    aggregatorTracker = new AggregatorTracker();
  });

  it("should keep track of aggregator for subnet / slot", () => {
    const subnet = 1;
    const slot = 1;

    aggregatorTracker.addAggregator(subnet, slot);

    expect(aggregatorTracker.shouldAggregate(subnet, slot)).toBe(true);
  });

  it("should prune the oldest slots first when maximum cache size is reached", () => {
    const {maxSlotsCached} = aggregatorTracker;
    const firstSlot = 0;
    const lastSlot = firstSlot + maxSlotsCached - 1;
    const subnet = 1;
    const slots = Array.from({length: maxSlotsCached}, (_, i) => firstSlot + i);

    // Slots should be inserted in random order
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }

    // Fill up the cache to its maximum size
    for (const slot of slots) {
      aggregatorTracker.addAggregator(subnet, slot);
    }

    // This should prune the first two slots
    aggregatorTracker.addAggregator(subnet, lastSlot + 1);
    aggregatorTracker.addAggregator(subnet, lastSlot + 2);
    aggregatorTracker.prune();

    expect(aggregatorTracker.shouldAggregate(subnet, firstSlot)).toBe(false);
    expect(aggregatorTracker.shouldAggregate(subnet, firstSlot + 1)).toBe(false);

    // Verify that all other slots are still available
    for (let slot = firstSlot + 2; slot <= lastSlot + 2; slot++) {
      expect(aggregatorTracker.shouldAggregate(subnet, slot)).toBeWithMessage(
        true,
        `expected aggregator for slot ${slot}`
      );
    }
  });
});
