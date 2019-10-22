import {assert} from "chai";

import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {BeaconState, Epoch, Slot} from "@chainsafe/eth2.0-types";
import {GENESIS_SLOT} from "../../../../src/constants";
import {
  computeStartSlotOfEpoch,
  getPreviousEpoch,
  getCurrentEpoch,
  computeActivationExitEpoch,
  computeEpochOfSlot,
} from "../../../../../eth2.0-state-transition/src/util";

import {generateState} from "../../../utils/state";


describe("computeEpochOfSlot", () => {
  const pairs = [
    {test: 0, expected: 0},
    {test: 1, expected: 0},
    {test: 10, expected: 0},
    {test: 100, expected: 1},
    {test: 1000, expected: 15},
    {test: 10000, expected: 156},
    {test: 100000, expected: 1562},
    {test: 1000000, expected: 15625},
  ];
  for (const pair of pairs) {
    it(`Slot ${pair.test} should map to epoch ${pair.expected}`, () => {
      const result: Epoch = computeEpochOfSlot(config, pair.test);
      assert.equal(result, pair.expected);
    });
  }
});

describe("computeStartSlotOfEpoch", () => {
  const pairs = [
    {test: 0, expected: 0},
    {test: 1, expected: 64},
    {test: 10, expected: 640},
    {test: 100, expected: 6400},
    {test: 1000, expected: 64000},
    {test: 10000, expected: 640000},
    {test: 100000, expected: 6400000},
    {test: 1000000, expected: 64000000},
  ];
  for (const pair of pairs) {
    it(`Epoch ${pair.test} should map to slot ${pair.expected}`, () => {
      const result: Slot = computeStartSlotOfEpoch(config, pair.test);
      assert.equal(result, pair.expected);
    });
  }
});

describe("getPreviousEpoch", () => {

  it("epoch should return previous epoch", () => {
    const state: BeaconState = generateState({slot: 512});
    const expected: Epoch = 7;
    const result = getPreviousEpoch(config, state);
    assert.equal(result, expected);
  });

  it("epoch should return previous epoch", () => {
    const state: BeaconState = generateState({slot: 256});
    const expected: Epoch = 3;
    const result = getPreviousEpoch(config, state);
    assert.equal(result, expected);
  });

  it("epoch should return genesis epoch", () => {
    const state: BeaconState = generateState({slot: GENESIS_SLOT});
    const expected: Epoch = computeEpochOfSlot(config, GENESIS_SLOT);
    const result = getPreviousEpoch(config, state);
    assert.equal(result, expected);
  });
});

describe("computeActivationExitEpoch", () => {
  it("epoch is always equal to the epoch after the exit delay", () => {
    for (let e: Epoch = 0; e < 1000; e++) {
      assert.equal(computeActivationExitEpoch(config, e), e + 1 + config.params.ACTIVATION_EXIT_DELAY);
    }
  });
});
