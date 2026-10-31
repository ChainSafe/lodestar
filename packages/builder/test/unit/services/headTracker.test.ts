import {describe, expect, it} from "vitest";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import type {RootHex, Slot} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {HeadEvent, HeadTracker} from "../../../src/services/headTracker.js";

function root(value: number): RootHex {
  return toRootHex(Buffer.alloc(32, value));
}

function head(slot: Slot, block: number, currentEpochDependentRoot: number, nextEpochDependentRoot: number) {
  return {
    slot,
    block: root(block),
    state: root(100),
    payloadStatus: "full",
    epochTransition: slot % SLOTS_PER_EPOCH === 0,
    currentEpochDependentRoot: root(currentEpochDependentRoot),
    nextEpochDependentRoot: root(nextEpochDependentRoot),
    executionOptimistic: false,
  } satisfies HeadEvent["data"];
}

describe("HeadTracker", () => {
  it("returns the dependent root for proposals in the epoch of the head and the one after", () => {
    const tracker = new HeadTracker();
    tracker.onHead(head(SLOTS_PER_EPOCH + 3, 1, 10, 11));

    expect(tracker.getDependentRoot(root(1), SLOTS_PER_EPOCH + 4)).toBe(root(10));
    expect(tracker.getDependentRoot(root(1), 2 * SLOTS_PER_EPOCH - 1)).toBe(root(10));
    expect(tracker.getDependentRoot(root(1), 2 * SLOTS_PER_EPOCH)).toBe(root(11));
    expect(tracker.getDependentRoot(root(1), 3 * SLOTS_PER_EPOCH)).toBeNull();
    expect(tracker.getDependentRoot(root(2), SLOTS_PER_EPOCH + 4)).toBeNull();
  });

  it("keeps the dependent roots of reorged heads", () => {
    const tracker = new HeadTracker();
    tracker.onHead(head(3, 1, 10, 11));
    tracker.onHead(head(3, 2, 12, 13));

    expect(tracker.getDependentRoot(root(1), 4)).toBe(root(10));
    expect(tracker.getDependentRoot(root(2), 4)).toBe(root(12));
  });

  it("prunes heads from before the previous epoch", () => {
    const tracker = new HeadTracker();
    tracker.onHead(head(SLOTS_PER_EPOCH - 1, 1, 10, 11));
    tracker.onHead(head(SLOTS_PER_EPOCH, 2, 12, 13));
    tracker.onHead(head(2 * SLOTS_PER_EPOCH, 3, 14, 15));

    expect(tracker.prune(2 * SLOTS_PER_EPOCH + 1)).toBe(1);
    expect(tracker.getDependentRoot(root(1), SLOTS_PER_EPOCH)).toBeNull();
    expect(tracker.getDependentRoot(root(2), 2 * SLOTS_PER_EPOCH + 1)).toBe(root(13));
    expect(tracker.getDependentRoot(root(3), 2 * SLOTS_PER_EPOCH + 1)).toBe(root(14));
    expect(tracker.prune(2 * SLOTS_PER_EPOCH + 1)).toBe(0);
  });
});
