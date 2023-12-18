import {describe, it, expect} from "vitest";

import {GENESIS_SLOT, MAX_SEED_LOOKAHEAD} from "@lodestar/params";
import {Epoch, Slot} from "@lodestar/types";
import {
  computeStartSlotAtEpoch,
  getPreviousEpoch,
  computeActivationExitEpoch,
  computeEpochAtSlot,
} from "../../../src/util/index.js";

import {generateState} from "../../utils/state.js";

describe("computeEpochAtSlot", () => {
  it.each([
    {test: 0, expected: 0},
    {test: 1, expected: 0},
    {test: 10, expected: 0},
    {test: 100, expected: 3},
    {test: 1000, expected: 31},
    {test: 10000, expected: 312},
    {test: 100000, expected: 3125},
    {test: 1000000, expected: 31250},
  ])("Slot $test should map to epoch $expected", ({test, expected}) => {
    const result: Epoch = computeEpochAtSlot(test);
    expect(result).toEqual(expected);
  });
});

describe("computeStartSlotAtEpoch", () => {
  it.each([
    {test: 0, expected: 0},
    {test: 1, expected: 32},
    {test: 10, expected: 320},
    {test: 100, expected: 3200},
    {test: 1000, expected: 32000},
    {test: 10000, expected: 320000},
    {test: 100000, expected: 3200000},
    {test: 1000000, expected: 32000000},
  ])("Epoch $test should map to slot $expected", ({test, expected}) => {
    const result: Slot = computeStartSlotAtEpoch(test);
    expect(result).toEqual(expected);
  });
});

describe("getPreviousEpoch", () => {
  it.each([
    {slot: 512, expectedEpoch: 15},
    {slot: 256, expectedEpoch: 7},
    {
      slot: GENESIS_SLOT,
      expectedEpoch: computeEpochAtSlot(GENESIS_SLOT),
    },
  ])("epoch should return previous epoch", ({slot, expectedEpoch}) => {
    const state = generateState({slot});
    const result = getPreviousEpoch(state);
    expect(result).toEqual(expectedEpoch);
  });
});

describe("computeActivationExitEpoch", () => {
  it("epoch is always equal to the epoch after the exit delay", () => {
    for (let e: Epoch = 0; e < 1000; e++) {
      expect(computeActivationExitEpoch(e)).toEqual(e + 1 + MAX_SEED_LOOKAHEAD);
    }
  });
});
