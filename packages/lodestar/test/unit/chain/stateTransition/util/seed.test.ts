import { assert } from "chai";

import {
  GENESIS_EPOCH,
  GENESIS_SLOT,
  LATEST_RANDAO_MIXES_LENGTH,
  SLOTS_PER_EPOCH,
} from "@chainsafe/eth2-types";

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
});
