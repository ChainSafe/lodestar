import { assert } from "chai";

import {config} from "../../../../../src/config/presets/mainnet";
import {
  GENESIS_EPOCH,
  GENESIS_SLOT,
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
      slot: GENESIS_SLOT + config.params.SLOTS_PER_EPOCH,
      latestRandaoMixes: [Buffer.from([0xAB]), Buffer.from([0xCD])]
    });
    const res = getRandaoMix(config, state, GENESIS_EPOCH);
    assert(res.equals(Uint8Array.from([0xAB])));
  });
  it("should return second randao mix for GENESIS_EPOCH + 1", () => {
    // Empty state in 2nd epoch
    const state = generateState({
      slot: GENESIS_SLOT + config.params.SLOTS_PER_EPOCH * 2,
      latestRandaoMixes: [Buffer.from([0xAB]), Buffer.from([0xCD]), Buffer.from([0xEF])]
    });
    const res = getRandaoMix(config, state, GENESIS_EPOCH + 1);
    assert(res.equals(Uint8Array.from([0xCD])));
  });
});
