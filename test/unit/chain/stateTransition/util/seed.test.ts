import { assert } from "chai";

import {
  GENESIS_EPOCH,
  GENESIS_SLOT,
  LATEST_RANDAO_MIXES_LENGTH,
  SLOTS_PER_EPOCH,
} from "../../../../../src/constants";

import {
  getRandaoMix,
  getActiveIndexRoot,
  generateSeed,
} from "../../../../../src/chain/stateTransition/util/seed";

import { generateState } from "../../../../utils/state";


describe("getRandaoMix", () => {
  it("should return first randao mix for GENESIS_EPOCH", () => {
    // Empty state in 2nd epoch
    const state = generateState({
      slot: GENESIS_SLOT + SLOTS_PER_EPOCH,
      latestRandaoMixes: [Buffer.from([0xAB]), Buffer.from([0xCD])]
    });
    const res = getRandaoMix(state, GENESIS_EPOCH);
    assert(res.equals(Uint8Array.from([0xAB])));
  });
  it("should return second randao mix for GENESIS_EPOCH + 1", () => {
    // Empty state in 2nd epoch
    const state = generateState({
      slot: GENESIS_SLOT + SLOTS_PER_EPOCH * 2,
      latestRandaoMixes: [Buffer.from([0xAB]), Buffer.from([0xCD]), Buffer.from([0xEF])]
    });
    const res = getRandaoMix(state, GENESIS_EPOCH + 1);
    assert(res.equals(Uint8Array.from([0xCD])));
  });
  it("should fail to get randao mix for epoch more than LATEST_RANDAO_MIXES_LENGTH in the past", () => {
    // Empty state in epoch LATEST_RANDAO_MIXES_LENGTH with incrementing randao mixes
    const state = generateState({
      slot: GENESIS_SLOT + SLOTS_PER_EPOCH * LATEST_RANDAO_MIXES_LENGTH,
      latestRandaoMixes: Array.from({ length: LATEST_RANDAO_MIXES_LENGTH }, (e, i) => Buffer.from([i]))
    });
    assert.throws(() => getRandaoMix(state, GENESIS_EPOCH), "");
  });
  it("should fail to get randao mix for epoch > current epoch", () => {
    // Empty state in second epoch (genesis + 1)
    const state = generateState({
      slot: GENESIS_SLOT + SLOTS_PER_EPOCH,
      latestRandaoMixes: [Buffer.from([0xAB]), Buffer.from([0xCD])]
    });
    assert.throws(() => getRandaoMix(state, GENESIS_EPOCH + 1), "");
  });
});
