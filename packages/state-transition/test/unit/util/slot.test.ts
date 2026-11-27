import {describe, expect, it} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {Epoch, Slot} from "@lodestar/types";
import {
  computeSlotAtTimeMs,
  computeSlotsSinceEpochStart,
  computeTimeAtSlotMs,
  getBlobDataRetentionStartEpoch,
  getSlotDurationMs,
  getSlotDurationMsAtEpoch,
} from "../../../src/util/index.js";

describe("computeSlotsSinceEpochStart", () => {
  const pairs = [
    {test: 0, expected: 0},
    {test: 5, expected: 5},
    {test: 40, expected: 8},
    {test: 50, expected: 18},
  ];

  for (const pair of pairs) {
    it(`Slot ${pair.test} is ${pair.expected} from current Epoch start`, () => {
      const result: Slot = computeSlotsSinceEpochStart(pair.test);
      expect(result).toEqual(pair.expected);
    });
  }

  it("should compute slot correctly since a specified epoch", () => {
    const epoch = 1;
    const slot = 70;
    const result = computeSlotsSinceEpochStart(slot, epoch);
    // 70 - NUM_SLOT_PER_EPOCH
    expect(result).toEqual(38);
  });
});

describe("getSlotDurationMs", () => {
  it("uses the configured duration on either side of a fork", () => {
    const config = createChainForkConfig({ALTAIR_FORK_EPOCH: 1});
    config.getSlotDurationMs = (fork) => (fork === ForkName.phase0 ? 12000 : 6000);

    expect(getSlotDurationMs(config, SLOTS_PER_EPOCH - 1)).toBe(12000);
    expect(getSlotDurationMs(config, SLOTS_PER_EPOCH)).toBe(6000);
  });
});

describe("slot duration schedule", () => {
  const config = createChainForkConfig({SLOT_DURATION_MS: 12000});
  const slotDurations: [Epoch, number][] = [
    [0, 12000],
    [1, 10000],
  ];
  const boundarySlot = SLOTS_PER_EPOCH;
  const genesisTimeMs = 1_600_000_000_000;
  const boundaryTimeMs = genesisTimeMs + boundarySlot * 12000;

  it("getSlotDurationMsAtEpoch returns the duration in effect at the epoch", () => {
    expect(getSlotDurationMsAtEpoch(config, 0, slotDurations)).toBe(12000);
    expect(getSlotDurationMsAtEpoch(config, 1, slotDurations)).toBe(10000);
  });

  it("computeTimeAtSlotMs is piecewise across the duration change", () => {
    expect(computeTimeAtSlotMs(config, boundarySlot - 1, genesisTimeMs, slotDurations)).toBe(boundaryTimeMs - 12000);
    expect(computeTimeAtSlotMs(config, boundarySlot, genesisTimeMs, slotDurations)).toBe(boundaryTimeMs);
    expect(computeTimeAtSlotMs(config, boundarySlot + 1, genesisTimeMs, slotDurations)).toBe(boundaryTimeMs + 10000);
    expect(computeTimeAtSlotMs(config, -1, genesisTimeMs, slotDurations)).toBe(genesisTimeMs - 12000);
  });

  it("computeSlotAtTimeMs inverts computeTimeAtSlotMs", () => {
    expect(computeSlotAtTimeMs(config, boundaryTimeMs - 1, genesisTimeMs, slotDurations)).toBe(boundarySlot - 1);
    expect(computeSlotAtTimeMs(config, boundaryTimeMs, genesisTimeMs, slotDurations)).toBe(boundarySlot);
    expect(computeSlotAtTimeMs(config, boundaryTimeMs + 9999, genesisTimeMs, slotDurations)).toBe(boundarySlot);
    expect(computeSlotAtTimeMs(config, boundaryTimeMs + 10000, genesisTimeMs, slotDurations)).toBe(boundarySlot + 1);
    expect(computeSlotAtTimeMs(config, genesisTimeMs - 1, genesisTimeMs, slotDurations)).toBe(-1);
  });

  it("uses the new duration from genesis when it changes at epoch 0", () => {
    const genesisSlotDurations: [Epoch, number][] = [
      [0, 12000],
      [0, 10000],
    ];
    expect(getSlotDurationMsAtEpoch(config, 0, genesisSlotDurations)).toBe(10000);
    expect(computeTimeAtSlotMs(config, 2, genesisTimeMs, genesisSlotDurations)).toBe(genesisTimeMs + 20000);
    expect(computeSlotAtTimeMs(config, genesisTimeMs + 20000, genesisTimeMs, genesisSlotDurations)).toBe(2);
    expect(computeTimeAtSlotMs(config, -1, genesisTimeMs, genesisSlotDurations)).toBe(genesisTimeMs - 10000);
    expect(computeSlotAtTimeMs(config, genesisTimeMs - 10000, genesisTimeMs, genesisSlotDurations)).toBe(-1);
  });
});

describe("getBlobDataRetentionStartEpoch", () => {
  const config = createChainForkConfig({MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS: 2});

  it("returns GENESIS_EPOCH while the chain is younger than the window", () => {
    expect(getBlobDataRetentionStartEpoch(config, 0)).toBe(0);
    expect(getBlobDataRetentionStartEpoch(config, 1)).toBe(0);
    expect(getBlobDataRetentionStartEpoch(config, 2)).toBe(0);
  });

  it("starts MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS before the current epoch", () => {
    expect(getBlobDataRetentionStartEpoch(config, 6)).toBe(4);
  });

  it("preserves the wall-clock window across a slot duration change", () => {
    const slotDurations: [Epoch, number][] = [
      [0, 12000],
      [2, 6000],
    ];
    // Epoch 6 starts 2 epochs at 12s and 4 epochs at 6s in, the 2-epoch window at 12s spans those 4 epochs
    expect(getBlobDataRetentionStartEpoch(config, 6, slotDurations)).toBe(2);
    expect(getBlobDataRetentionStartEpoch(config, 2, slotDurations)).toBe(0);
  });
});
