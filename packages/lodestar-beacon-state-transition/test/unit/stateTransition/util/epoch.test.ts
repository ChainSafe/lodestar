import {assert} from "chai";

import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {BeaconState, Epoch, Slot} from "@chainsafe/lodestar-types";
import {GENESIS_SLOT} from "../../../../src/constants";
import {
  computeStartSlotAtEpoch,
  getPreviousEpoch,
  getCurrentEpoch,
  computeActivationExitEpoch,
  computeEpochAtSlot,
} from "../../../../src/util";

import {generateState} from "../../../utils/state";


describe("computeEpochAtSlot", () => {
  const pairs = [
    {test: 0n, expected: 0n},
    {test: 1n, expected: 0n},
    {test: 10n, expected: 0n},
    {test: 100n, expected: 3n},
    {test: 1000n, expected: 31n},
    {test: 10000n, expected: 312n},
    {test: 100000n, expected: 3125n},
    {test: 1000000n, expected: 31250n},
  ];
  for (const pair of pairs) {
    it(`Slot ${pair.test} should map to epoch ${pair.expected}`, () => {
      const result: Epoch = computeEpochAtSlot(config, pair.test);
      assert.equal(result, pair.expected);
    });
  }
});

describe("computeStartSlotAtEpoch", () => {
  const pairs = [
    {test: 0n, expected: 0n},
    {test: 1n, expected: 32n},
    {test: 10n, expected: 320n},
    {test: 100n, expected: 3200n},
    {test: 1000n, expected: 32000n},
    {test: 10000n, expected: 320000n},
    {test: 100000n, expected: 3200000n},
    {test: 1000000n, expected: 32000000n},
  ];
  for (const pair of pairs) {
    it(`Epoch ${pair.test} should map to slot ${pair.expected}`, () => {
      const result: Slot = computeStartSlotAtEpoch(config, pair.test);
      assert.equal(result, pair.expected);
    });
  }
});

describe("getPreviousEpoch", () => {

  it("epoch should return previous epoch", () => {
    const state: BeaconState = generateState({slot: 512n});
    const expected: Epoch = 15n;
    const result = getPreviousEpoch(config, state);
    assert.equal(result, expected);
  });

  it("epoch should return previous epoch", () => {
    const state: BeaconState = generateState({slot: 256n});
    const expected: Epoch = 7n;
    const result = getPreviousEpoch(config, state);
    assert.equal(result, expected);
  });

  it("epoch should return genesis epoch", () => {
    const state: BeaconState = generateState({slot: GENESIS_SLOT});
    const expected: Epoch = computeEpochAtSlot(config, GENESIS_SLOT);
    const result = getPreviousEpoch(config, state);
    assert.equal(result, expected);
  });
});

describe("computeActivationExitEpoch", () => {
  it("epoch is always equal to the epoch after the exit delay", () => {
    for (let e: Epoch = 0n; e < 1000n; e++) {
      assert.equal(computeActivationExitEpoch(config, e), e + 1n + config.params.MAX_SEED_LOOKAHEAD);
    }
  });
});
