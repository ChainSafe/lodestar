import {describe, expect, it} from "vitest";
import {SeenBlockAttesters} from "../../../../src/chain/seenCache/seenBlockAttesters.js";

describe("SeenBlockAttesters", () => {
  it("tracks indices per epoch", () => {
    const cache = new SeenBlockAttesters();

    cache.addIndices(10, [0, 7, 8, 1_000_000]);
    cache.addIndices(11, [9]);

    for (const index of [0, 7, 8, 1_000_000]) {
      expect(cache.isKnown(10, index), `index ${index} at epoch 10`).toBe(true);
    }
    for (const index of [1, 6, 9, 999_999, 1_000_001]) {
      expect(cache.isKnown(10, index), `index ${index} at epoch 10`).toBe(false);
    }
    expect(cache.isKnown(11, 9)).toBe(true);
    expect(cache.isKnown(11, 0)).toBe(false);
    expect(cache.isKnown(12, 0)).toBe(false);
  });

  it("keeps earlier indices when a later call adds higher or lower ones", () => {
    const cache = new SeenBlockAttesters();
    const added = [5, 3, 70_000, 12, 2_300_000, 64, 1];

    for (const index of added) {
      cache.addIndices(0, [index]);
    }
    // an epoch created after the growth starts at the grown size
    cache.addIndices(1, [2_300_000, 2]);

    for (const index of added) {
      expect(cache.isKnown(0, index), `index ${index} at epoch 0`).toBe(true);
    }
    expect(cache.isKnown(0, 2)).toBe(false);
    expect(cache.isKnown(1, 2)).toBe(true);
    expect(cache.isKnown(1, 2_300_000)).toBe(true);
    expect(cache.isKnown(1, 5)).toBe(false);
  });

  it("grows an existing epoch after another epoch has grown past it", () => {
    const cache = new SeenBlockAttesters();

    cache.addIndices(0, [5]);
    cache.addIndices(1, [100_000]);
    cache.addIndices(0, [700, 50_000]);
    cache.addIndices(2, [3]);

    for (const index of [5, 700, 50_000]) {
      expect(cache.isKnown(0, index), `index ${index} at epoch 0`).toBe(true);
    }
    expect(cache.isKnown(0, 100_000)).toBe(false);
    expect(cache.isKnown(1, 100_000)).toBe(true);
    expect(cache.isKnown(1, 5)).toBe(false);
    expect(cache.isKnown(2, 3)).toBe(true);
    expect(cache.isKnown(2, 100_000)).toBe(false);
  });

  it("does not report out of range or non-integer indices as known", () => {
    const cache = new SeenBlockAttesters();
    cache.addIndices(0, [0, 2, 15]);

    for (const index of [
      2 ** 32,
      2 ** 32 + 2,
      2 ** 35 + 2,
      Number.MAX_SAFE_INTEGER,
      -1,
      -(2 ** 32) + 2,
      2.5,
      Number.NaN,
    ]) {
      expect(cache.isKnown(0, index), `index ${index}`).toBe(false);
    }
  });

  it("prunes epochs older than the lookback and rejects adding to them", () => {
    const cache = new SeenBlockAttesters();
    cache.addIndices(7, [1]);
    cache.addIndices(8, [1]);
    cache.addIndices(10, [1]);

    cache.prune(10);

    expect(cache.isKnown(7, 1)).toBe(false);
    expect(cache.isKnown(8, 1)).toBe(true);
    expect(cache.isKnown(10, 1)).toBe(true);
    expect(() => cache.addIndices(7, [2])).toThrow("EpochTooLow 7 < 8");
    cache.addIndices(8, [2]);
    expect(cache.isKnown(8, 2)).toBe(true);
  });
});
