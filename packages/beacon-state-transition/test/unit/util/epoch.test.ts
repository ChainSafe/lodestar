import {assert} from "chai";

import {GENESIS_SLOT, MAX_SEED_LOOKAHEAD} from "@chainsafe/lodestar-params";
import {Epoch, Slot} from "@chainsafe/lodestar-types";
import {
  computeStartSlotAtEpoch,
  getPreviousEpoch,
  computeActivationExitEpoch,
  computeEpochAtSlot,
} from "../../../src/util/index.js";

import {generateState} from "../../utils/state.js";

describe("computeEpochAtSlot", () => {
  const pairs = [
    {test: 0, expected: 0},
    {test: 1, expected: 0},
    {test: 10, expected: 0},
    {test: 100, expected: 3},
    {test: 1000, expected: 31},
    {test: 10000, expected: 312},
    {test: 100000, expected: 3125},
    {test: 1000000, expected: 31250},
  ];
  for (const pair of pairs) {
    it(`Slot ${pair.test} should map to epoch ${pair.expected}`, () => {
      const result: Epoch = computeEpochAtSlot(pair.test);
      assert.equal(result, pair.expected);
    });
  }
});

describe("computeStartSlotAtEpoch", () => {
  const pairs = [
    {test: 0, expected: 0},
    {test: 1, expected: 32},
    {test: 10, expected: 320},
    {test: 100, expected: 3200},
    {test: 1000, expected: 32000},
    {test: 10000, expected: 320000},
    {test: 100000, expected: 3200000},
    {test: 1000000, expected: 32000000},
  ];
  for (const pair of pairs) {
    it(`Epoch ${pair.test} should map to slot ${pair.expected}`, () => {
      const result: Slot = computeStartSlotAtEpoch(pair.test);
      assert.equal(result, pair.expected);
    });
  }
});

describe("getPreviousEpoch", () => {
  const testValues = [
    {slot: 512, expectedEpoch: 15},
    {slot: 256, expectedEpoch: 7},
    {
      slot: GENESIS_SLOT,
      expectedEpoch: computeEpochAtSlot(GENESIS_SLOT),
    },
  ];

  for (const testValue of testValues) {
    it("epoch should return previous epoch", () => {
      const state = generateState({slot: testValue.slot});
      const result = getPreviousEpoch(state);
      assert.equal(result, testValue.expectedEpoch);
    });
  }
});

describe("computeActivationExitEpoch", () => {
  it("epoch is always equal to the epoch after the exit delay", () => {
    for (let e: Epoch = 0; e < 1000; e++) {
      assert.equal(computeActivationExitEpoch(e), e + 1 + MAX_SEED_LOOKAHEAD);
    }
  });
});
