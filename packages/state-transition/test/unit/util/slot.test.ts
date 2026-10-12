import {describe, expect, it} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {Slot} from "@lodestar/types";
import {computeSlotsSinceEpochStart, getSlotDurationMs} from "../../../src/util/index.js";

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
