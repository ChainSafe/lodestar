import {describe, expect, it} from "vitest";
import {toRootHex} from "@lodestar/utils";
import {SeenBlockProposers} from "../../../../src/chain/seenCache/seenBlockProposers.js";

describe("SeenBlockProposers", () => {
  const slot = 32;
  const proposerIndex = 1;
  const blockRoot = toRootHex(Buffer.alloc(32, 1));
  const conflictingBlockRoot = toRootHex(Buffer.alloc(32, 2));

  it("tracks signature-verified roots separately from gossip-accepted proposals", () => {
    const cache = new SeenBlockProposers();

    cache.observeBlockRoot(slot, proposerIndex, blockRoot);

    expect(cache.isKnown(slot, proposerIndex)).toBe(false);
    expect(cache.hasBlockRoot(slot, proposerIndex, blockRoot)).toBe(true);

    cache.add(slot, proposerIndex, blockRoot);
    cache.observeBlockRoot(slot, proposerIndex, conflictingBlockRoot);

    expect(cache.isKnown(slot, proposerIndex)).toBe(true);
    expect(cache.getConflictingBlockRoots(slot, proposerIndex, blockRoot)).toEqual([conflictingBlockRoot]);
    expect(cache.getConflictingBlockRoots(slot, proposerIndex, conflictingBlockRoot)).toEqual([blockRoot]);
  });

  it("prunes accepted proposals and observed roots", () => {
    const cache = new SeenBlockProposers();
    cache.add(slot, proposerIndex, blockRoot);

    cache.prune(slot + 1);

    expect(cache.isKnown(slot, proposerIndex)).toBe(false);
    expect(cache.hasBlockRoot(slot, proposerIndex, blockRoot)).toBe(false);
    expect(cache.getConflictingBlockRoots(slot, proposerIndex, conflictingBlockRoot)).toEqual([]);
  });
});
