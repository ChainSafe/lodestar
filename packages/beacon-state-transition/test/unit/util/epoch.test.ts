import {expect} from "chai";

import {GENESIS_SLOT, MAX_SEED_LOOKAHEAD} from "@chainsafe/lodestar-params";
import {phase0, Epoch} from "@chainsafe/lodestar-types";
import {
  computeStartSlotAtEpoch,
  getPreviousEpoch,
  computeActivationExitEpoch,
  computeEpochAtSlot,
} from "../../../src/util";

import {generateState} from "../../utils/state";

// NOTE: MUST USE MINIMAL PRESET

describe("computeEpochAtSlot", () => {
  const cases = {
    0: 0,
    1: 0,
    10: 1,
    100: 12,
    1000: 125,
    10000: 1250,
    100000: 12500,
    1000000: 125000,
  };

  it("Slots should map to epochs", () => {
    const res: Record<number, number> = {};
    for (const slot of Object.keys(cases).map((n) => parseInt(n))) {
      res[slot] = computeEpochAtSlot(slot);
    }
    expect(res).to.deep.equal(cases);
  });
});

describe("computeStartSlotAtEpoch", () => {
  const cases = {
    0: 0,
    1: 8,
    10: 80,
    100: 800,
    1000: 8000,
    10000: 80000,
    100000: 800000,
    1000000: 8000000,
  };

  it("Epochs should map to slots", () => {
    const res: Record<number, number> = {};
    for (const epoch of Object.keys(cases).map((n) => parseInt(n))) {
      res[epoch] = computeStartSlotAtEpoch(epoch);
    }
    expect(res).to.deep.equal(cases);
  });
});

describe("getPreviousEpoch", () => {
  const testValues = [
    {slot: 256, expectedEpoch: 31},
    {slot: 512, expectedEpoch: 63},
    {slot: GENESIS_SLOT, expectedEpoch: computeEpochAtSlot(GENESIS_SLOT)},
  ];

  for (const {slot, expectedEpoch} of testValues) {
    it(`epoch should return previous epoch of slot ${slot}`, () => {
      const state: phase0.BeaconState = generateState({slot});
      const result = getPreviousEpoch(state);
      expect(result).equal(expectedEpoch);
    });
  }
});

describe("computeActivationExitEpoch", () => {
  it("epoch is always equal to the epoch after the exit delay", () => {
    for (let e: Epoch = 0; e < 1000; e++) {
      expect(computeActivationExitEpoch(e)).equal(e + 1 + MAX_SEED_LOOKAHEAD);
    }
  });
});
