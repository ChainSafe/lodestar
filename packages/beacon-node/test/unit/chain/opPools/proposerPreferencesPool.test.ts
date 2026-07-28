import {beforeEach, describe, expect, it} from "vitest";
import {toHexString} from "@chainsafe/ssz";
import {gloas} from "@lodestar/types";
import {ProposerPreferencesPool} from "../../../../src/chain/opPools/proposerPreferencesPool.js";

describe("chain / opPools / ProposerPreferencesPool", () => {
  const makePrefs = (
    proposalSlot: number,
    validatorIndex: number,
    dependentRoot: Uint8Array
  ): gloas.SignedProposerPreferences => ({
    message: {
      dependentRoot,
      proposalSlot,
      validatorIndex,
      feeRecipient: Buffer.alloc(20, 0xab),
      targetGasLimit: 30_000_000,
    },
    signature: Buffer.alloc(96, 0),
  });

  const rootA = Buffer.alloc(32, 0xa);
  const rootB = Buffer.alloc(32, 0xb);
  const rootAHex = toHexString(rootA);
  const rootBHex = toHexString(rootB);

  let pool: ProposerPreferencesPool;
  beforeEach(() => {
    pool = new ProposerPreferencesPool();
  });

  it("returns null for missing slot", () => {
    expect(pool.get(10, rootAHex)).toBeNull();
  });

  it("returns the entry after add", () => {
    const prefs = makePrefs(10, 1, rootA);
    pool.add(prefs);
    expect(pool.get(10, rootAHex)).toBe(prefs);
  });

  it("distinguishes gossip entries from locally submitted entries", () => {
    pool.add(makePrefs(10, 1, rootA));
    expect(pool.isKnown(10, rootAHex, 1)).toBe(true);
    expect(pool.isKnownLocal(10, rootAHex, 1)).toBe(false);

    pool.add(makePrefs(10, 1, rootA), {local: true});
    expect(pool.isKnownLocal(10, rootAHex, 1)).toBe(true);
  });

  it("can mark an existing gossip entry as local without replacing it", () => {
    const prefs = makePrefs(10, 1, rootA);
    pool.add(prefs);

    expect(pool.markLocal(10, rootAHex, 1)).toBe(true);
    expect(pool.get(10, rootAHex)).toBe(prefs);
    expect(pool.isKnownLocal(10, rootAHex, 1)).toBe(true);
  });

  it("does not mark unknown entries as local", () => {
    expect(pool.markLocal(10, rootAHex, 1)).toBe(false);
    expect(pool.isKnownLocal(10, rootAHex, 1)).toBe(false);
  });

  it("removes only the exact stored entry and clears the local marker", () => {
    const prefs = makePrefs(10, 1, rootA);
    const replacement = makePrefs(10, 1, rootA);
    pool.add(prefs, {local: true});

    expect(pool.remove(replacement)).toBe(false);
    expect(pool.get(10, rootAHex)).toBe(prefs);
    expect(pool.isKnownLocal(10, rootAHex, 1)).toBe(true);

    expect(pool.remove(prefs)).toBe(true);
    expect(pool.get(10, rootAHex)).toBeNull();
    expect(pool.isKnownLocal(10, rootAHex, 1)).toBe(false);
  });

  it("returns null for unknown dependent_root at a known slot", () => {
    pool.add(makePrefs(10, 1, rootA));
    expect(pool.get(10, rootBHex)).toBeNull();
  });

  it("isolates entries by dependent_root at the same slot", () => {
    const a = makePrefs(10, 1, rootA);
    const b = makePrefs(10, 2, rootB);
    pool.add(a);
    pool.add(b);
    expect(pool.get(10, rootAHex)).toBe(a);
    expect(pool.get(10, rootBHex)).toBe(b);
  });

  it("getAll(slot) returns all branch entries for that slot only", () => {
    pool.add(makePrefs(10, 1, rootA));
    pool.add(makePrefs(10, 2, rootB));
    pool.add(makePrefs(11, 3, rootA));
    expect(pool.getAll(10)).toHaveLength(2);
  });

  it("getAll() flattens across all slots", () => {
    pool.add(makePrefs(10, 1, rootA));
    pool.add(makePrefs(11, 2, rootA));
    pool.add(makePrefs(12, 3, rootB));
    expect(pool.getAll()).toHaveLength(3);
  });

  it("prune drops slots < currentSlot but retains currentSlot and later", () => {
    pool.add(makePrefs(10, 1, rootA), {local: true});
    pool.add(makePrefs(11, 2, rootA));
    pool.add(makePrefs(12, 3, rootA), {local: true});
    pool.prune(11);
    expect(pool.get(10, rootAHex)).toBeNull();
    expect(pool.isKnownLocal(10, rootAHex, 1)).toBe(false);
    expect(pool.get(11, rootAHex)).not.toBeNull();
    expect(pool.get(12, rootAHex)).not.toBeNull();
    expect(pool.isKnownLocal(12, rootAHex, 3)).toBe(true);
  });
});
