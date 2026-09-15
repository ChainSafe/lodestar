import {describe, expect, it} from "vitest";
import {phase0, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {SeenBlockProposers} from "../../../../src/chain/seenCache/seenBlockProposers.js";

describe("SeenBlockProposers", () => {
  const slot = 32;
  const proposerIndex = 1;
  const blockRoot = toRootHex(Buffer.alloc(32, 1));
  const conflictingBlockRoot = toRootHex(Buffer.alloc(32, 2));
  const additionalBlockRoot = toRootHex(Buffer.alloc(32, 3));

  function signedHeader(seed: number): phase0.SignedBeaconBlockHeader {
    const header = ssz.phase0.SignedBeaconBlockHeader.defaultValue();
    header.message.slot = slot;
    header.message.proposerIndex = proposerIndex;
    header.message.bodyRoot = Buffer.alloc(32, seed);
    return header;
  }

  const header1 = signedHeader(1);
  const header2 = signedHeader(2);
  const header3 = signedHeader(3);

  it("tracks observed block roots separately from known proposals", () => {
    const cache = new SeenBlockProposers();

    cache.observeBlockRoot(slot, proposerIndex, blockRoot, header1);

    expect(cache.isKnown(slot, proposerIndex)).toBe(false);
    expect(cache.hasBlockRoot(slot, proposerIndex, blockRoot)).toBe(true);
    expect(cache.getEquivocationHeaders(slot, proposerIndex)).toBe(null);

    cache.add(slot, proposerIndex, blockRoot);
    cache.observeBlockRoot(slot, proposerIndex, conflictingBlockRoot, header2);

    expect(cache.isKnown(slot, proposerIndex)).toBe(true);
    expect(cache.isEquivocating(slot, proposerIndex)).toBe(true);
    expect(cache.getConflictingBlockRoots(slot, proposerIndex, blockRoot)).toEqual([conflictingBlockRoot]);
    expect(cache.getConflictingBlockRoots(slot, proposerIndex, conflictingBlockRoot)).toEqual([blockRoot]);
    expect(cache.getEquivocationHeaders(slot, proposerIndex)).toEqual([header1, header2]);
  });

  it("flags a repeat proposal only for a different block root", () => {
    const cache = new SeenBlockProposers();

    // Not known yet: never a repeat, regardless of root
    expect(cache.isRepeatProposal(slot, proposerIndex, blockRoot)).toBe(false);

    cache.add(slot, proposerIndex, blockRoot);

    // Known with the same root: a benign duplicate, not a repeat
    expect(cache.isRepeatProposal(slot, proposerIndex, blockRoot)).toBe(false);
    // Known with a different root: a genuine equivocation
    expect(cache.isRepeatProposal(slot, proposerIndex, conflictingBlockRoot)).toBe(true);
  });

  it("stores at most two roots per slot and proposer", () => {
    const cache = new SeenBlockProposers();

    cache.observeBlockRoot(slot, proposerIndex, blockRoot, header1);
    cache.observeBlockRoot(slot, proposerIndex, conflictingBlockRoot, header2);
    cache.observeBlockRoot(slot, proposerIndex, additionalBlockRoot, header3);

    expect(cache.isEquivocating(slot, proposerIndex)).toBe(true);
    expect(cache.hasBlockRoot(slot, proposerIndex, additionalBlockRoot)).toBe(false);
    expect(cache.getConflictingBlockRoots(slot, proposerIndex, additionalBlockRoot)).toEqual([
      blockRoot,
      conflictingBlockRoot,
    ]);
    expect(cache.getEquivocationHeaders(slot, proposerIndex)).toEqual([header1, header2]);
  });

  it("does not overwrite the header of an already observed root", () => {
    const cache = new SeenBlockProposers();

    cache.observeBlockRoot(slot, proposerIndex, blockRoot, header1);
    cache.observeBlockRoot(slot, proposerIndex, blockRoot, header3);
    cache.observeBlockRoot(slot, proposerIndex, conflictingBlockRoot, header2);

    expect(cache.getEquivocationHeaders(slot, proposerIndex)).toEqual([header1, header2]);
  });

  it("prunes known proposals and observed roots", () => {
    const cache = new SeenBlockProposers();
    cache.observeBlockRoot(slot, proposerIndex, blockRoot, header1);
    cache.add(slot, proposerIndex, blockRoot);

    cache.prune(slot + 1);

    expect(cache.isKnown(slot, proposerIndex)).toBe(false);
    expect(cache.hasBlockRoot(slot, proposerIndex, blockRoot)).toBe(false);
    expect(cache.getConflictingBlockRoots(slot, proposerIndex, conflictingBlockRoot)).toEqual([]);
    expect(cache.getEquivocationHeaders(slot, proposerIndex)).toBe(null);
  });

  it("keeps the first seen timestamp of a block root", () => {
    const cache = new SeenBlockProposers();

    cache.observeFirstSeen(slot, blockRoot, 10);
    cache.observeFirstSeen(slot, blockRoot, 20);
    cache.observeFirstSeen(slot, conflictingBlockRoot, 30);

    expect(cache.getFirstSeenTimestampSec(slot, blockRoot)).toBe(10);
    expect(cache.getFirstSeenTimestampSec(slot, conflictingBlockRoot)).toBe(30);
    expect(cache.getFirstSeenTimestampSec(slot, additionalBlockRoot)).toBe(undefined);
    expect(cache.getFirstSeenTimestampSec(slot + 1, blockRoot)).toBe(undefined);
  });

  it("bounds first seen block roots per slot", () => {
    const cache = new SeenBlockProposers();

    for (let i = 0; i < 4096; i++) {
      cache.observeFirstSeen(slot, toRootHex(Buffer.from(i.toString(16).padStart(64, "0"), "hex")), i);
    }
    cache.observeFirstSeen(slot, blockRoot, 10);
    cache.observeFirstSeen(slot + 1, blockRoot, 10);

    expect(cache.getFirstSeenTimestampSec(slot, blockRoot)).toBe(undefined);
    expect(cache.getFirstSeenTimestampSec(slot + 1, blockRoot)).toBe(10);
  });

  it("prunes first seen block roots and ignores finalized slots", () => {
    const cache = new SeenBlockProposers();
    cache.observeFirstSeen(slot, blockRoot, 10);

    cache.prune(slot + 1);
    cache.observeFirstSeen(slot, conflictingBlockRoot, 20);

    expect(cache.getFirstSeenTimestampSec(slot, blockRoot)).toBe(undefined);
    expect(cache.getFirstSeenTimestampSec(slot, conflictingBlockRoot)).toBe(undefined);
  });

  it("rejects updates for slots before the finalized slot", () => {
    const cache = new SeenBlockProposers();
    cache.prune(slot + 1);

    expect(() => cache.add(slot, proposerIndex, blockRoot)).toThrow(`blockSlot ${slot} < finalizedSlot ${slot + 1}`);
    expect(() => cache.observeBlockRoot(slot, proposerIndex, blockRoot, header1)).toThrow(
      `blockSlot ${slot} < finalizedSlot ${slot + 1}`
    );
    expect(cache.isKnown(slot, proposerIndex)).toBe(false);
    expect(cache.hasBlockRoot(slot, proposerIndex, blockRoot)).toBe(false);
  });
});
