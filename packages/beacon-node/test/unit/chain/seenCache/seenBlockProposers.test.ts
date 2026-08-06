import {describe, expect, it} from "vitest";
import {toRootHex} from "@lodestar/utils";
import {SeenBlockProposers} from "../../../../src/chain/seenCache/seenBlockProposers.js";

describe("SeenBlockProposers", () => {
  const slot = 32;
  const proposerIndex = 1;
  const blockRoot = toRootHex(Buffer.alloc(32, 1));
  const conflictingBlockRoot = toRootHex(Buffer.alloc(32, 2));
  const additionalBlockRoot = toRootHex(Buffer.alloc(32, 3));

  it("tracks observed block roots separately from known proposals", () => {
    const cache = new SeenBlockProposers();

    cache.observeBlockRoot(slot, proposerIndex, blockRoot);

    expect(cache.isKnown(slot, proposerIndex)).toBe(false);
    expect(cache.hasBlockRoot(slot, proposerIndex, blockRoot)).toBe(true);

    cache.add(slot, proposerIndex);
    cache.observeBlockRoot(slot, proposerIndex, conflictingBlockRoot);

    expect(cache.isKnown(slot, proposerIndex)).toBe(true);
    expect(cache.isEquivocating(slot, proposerIndex)).toBe(true);
    expect(cache.getConflictingBlockRoots(slot, proposerIndex, blockRoot)).toEqual([conflictingBlockRoot]);
    expect(cache.getConflictingBlockRoots(slot, proposerIndex, conflictingBlockRoot)).toEqual([blockRoot]);
  });

  it("stores at most two roots per slot and proposer", () => {
    const cache = new SeenBlockProposers();

    cache.observeBlockRoot(slot, proposerIndex, blockRoot);
    cache.observeBlockRoot(slot, proposerIndex, conflictingBlockRoot);
    cache.observeBlockRoot(slot, proposerIndex, additionalBlockRoot);

    expect(cache.isEquivocating(slot, proposerIndex)).toBe(true);
    expect(cache.hasBlockRoot(slot, proposerIndex, additionalBlockRoot)).toBe(false);
    expect(cache.getConflictingBlockRoots(slot, proposerIndex, additionalBlockRoot)).toEqual([
      blockRoot,
      conflictingBlockRoot,
    ]);
  });

  it("prunes known proposals and observed roots", () => {
    const cache = new SeenBlockProposers();
    cache.observeBlockRoot(slot, proposerIndex, blockRoot);
    cache.add(slot, proposerIndex);

    cache.prune(slot + 1);

    expect(cache.isKnown(slot, proposerIndex)).toBe(false);
    expect(cache.hasBlockRoot(slot, proposerIndex, blockRoot)).toBe(false);
    expect(cache.getConflictingBlockRoots(slot, proposerIndex, conflictingBlockRoot)).toEqual([]);
  });

  it("rejects updates for slots before the finalized slot", () => {
    const cache = new SeenBlockProposers();
    cache.prune(slot + 1);

    expect(() => cache.add(slot, proposerIndex)).toThrow(`blockSlot ${slot} < finalizedSlot ${slot + 1}`);
    expect(() => cache.observeBlockRoot(slot, proposerIndex, blockRoot)).toThrow(
      `blockSlot ${slot} < finalizedSlot ${slot + 1}`
    );
    expect(cache.isKnown(slot, proposerIndex)).toBe(false);
    expect(cache.hasBlockRoot(slot, proposerIndex, blockRoot)).toBe(false);
  });
});
