import {describe, expect, it} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {Slot} from "@lodestar/types";
import {
  computeSlotAtTimeMs,
  computeSlotsSinceEpochStart,
  computeTimeAtSlot,
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
  const config = createChainForkConfig({
    SLOT_DURATION_MS: 12000,
    HEZE_FORK_EPOCH: 1,
    SLOT_DURATION_MS_HEZE: 10000,
  });
  const boundarySlot = SLOTS_PER_EPOCH;
  const genesisTime = 1_600_000_000;
  const boundaryTime = genesisTime + boundarySlot * 12;

  it("getSlotDurationMsAtEpoch returns the duration in effect at the epoch", () => {
    expect(getSlotDurationMsAtEpoch(config, 0)).toBe(12000);
    expect(getSlotDurationMsAtEpoch(config, 1)).toBe(10000);
  });

  it("computeTimeAtSlot is piecewise across the fork boundary", () => {
    expect(computeTimeAtSlot(config, boundarySlot - 1, genesisTime)).toBe(boundaryTime - 12);
    expect(computeTimeAtSlot(config, boundarySlot, genesisTime)).toBe(boundaryTime);
    expect(computeTimeAtSlot(config, boundarySlot + 1, genesisTime)).toBe(boundaryTime + 10);
    expect(computeTimeAtSlot(config, -1, genesisTime)).toBe(genesisTime - 12);
  });

  it("computeSlotAtTimeMs inverts computeTimeAtSlot", () => {
    expect(computeSlotAtTimeMs(config, boundaryTime * 1000 - 1, genesisTime * 1000)).toBe(boundarySlot - 1);
    expect(computeSlotAtTimeMs(config, boundaryTime * 1000, genesisTime * 1000)).toBe(boundarySlot);
    expect(computeSlotAtTimeMs(config, boundaryTime * 1000 + 9999, genesisTime * 1000)).toBe(boundarySlot);
    expect(computeSlotAtTimeMs(config, boundaryTime * 1000 + 10000, genesisTime * 1000)).toBe(boundarySlot + 1);
    expect(computeSlotAtTimeMs(config, genesisTime * 1000 - 1, genesisTime * 1000)).toBe(-1);
  });

  it("uses the heze duration from genesis when heze is scheduled at epoch 0", () => {
    const genesisHezeConfig = createChainForkConfig({
      SLOT_DURATION_MS: 12000,
      HEZE_FORK_EPOCH: 0,
      SLOT_DURATION_MS_HEZE: 10000,
    });
    expect(getSlotDurationMsAtEpoch(genesisHezeConfig, 0)).toBe(10000);
    expect(computeTimeAtSlot(genesisHezeConfig, 2, genesisTime)).toBe(genesisTime + 20);
    expect(computeSlotAtTimeMs(genesisHezeConfig, (genesisTime + 20) * 1000, genesisTime * 1000)).toBe(2);
    expect(computeTimeAtSlot(genesisHezeConfig, -1, genesisTime)).toBe(genesisTime - 10);
    expect(computeSlotAtTimeMs(genesisHezeConfig, (genesisTime - 10) * 1000, genesisTime * 1000)).toBe(-1);
  });
});

describe("getBlobDataRetentionStartEpoch", () => {
  const epochMs = SLOTS_PER_EPOCH * 12000;
  const config = createChainForkConfig({
    SLOT_DURATION_MS: 12000,
    HEZE_FORK_EPOCH: 2,
    SLOT_DURATION_MS_HEZE: 6000,
    MIN_BLOB_DATA_RETENTION_MS: 2 * epochMs,
  });

  it("returns GENESIS_EPOCH while the chain is younger than the window", () => {
    expect(getBlobDataRetentionStartEpoch(config, 0)).toBe(0);
    expect(getBlobDataRetentionStartEpoch(config, 1)).toBe(0);
  });

  it("preserves the wall-clock window across a slot duration change", () => {
    // Epoch 4 starts 2 pre-heze epochs + 2 half-duration epochs in; the 2-epoch wall-clock
    // window spans the 4 heze epochs that fit in it
    expect(getBlobDataRetentionStartEpoch(config, 4 + 2)).toBe(2);
    // Fully pre-heze window
    expect(getBlobDataRetentionStartEpoch(config, 2)).toBe(0);
  });
});
