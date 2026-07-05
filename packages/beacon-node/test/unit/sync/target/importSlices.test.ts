import {describe, expect, it} from "vitest";
import {sliceHeaderChainByEpoch} from "../../../../src/sync/target/importSlices.js";
import {HeaderChainElement} from "../../../../src/sync/target/types.js";

// SLOTS_PER_EPOCH = 32 (mainnet preset used by computeEpochAtSlot)
// slots [30,31] → epoch 0, [32,33] → epoch 1, [64] → epoch 2
describe("sliceHeaderChainByEpoch", () => {
  it("groups a slot-ascending header chain into contiguous same-epoch segments (bottom-up)", () => {
    const headerChain = [30, 31, 32, 33, 64].map((slot) => ({slot}) as HeaderChainElement);
    const segs = sliceHeaderChainByEpoch(headerChain);

    // Three segments, ascending epoch order
    expect(segs.map((s) => s.epoch)).toEqual([0, 1, 2]);

    // Correct element counts per segment
    expect(segs.map((s) => s.elements.length)).toEqual([2, 2, 1]);

    // Every element appears in exactly one segment, in original order
    expect(segs.flatMap((s) => s.elements)).toEqual(headerChain);
  });

  it("returns a single segment when all elements share the same epoch", () => {
    const headerChain = [0, 1, 5, 10].map((slot) => ({slot}) as HeaderChainElement);
    const segs = sliceHeaderChainByEpoch(headerChain);

    expect(segs).toHaveLength(1);
    expect(segs[0].epoch).toBe(0);
    expect(segs[0].elements).toEqual(headerChain);
  });

  it("returns an empty array for an empty header chain", () => {
    expect(sliceHeaderChainByEpoch([])).toEqual([]);
  });
});
