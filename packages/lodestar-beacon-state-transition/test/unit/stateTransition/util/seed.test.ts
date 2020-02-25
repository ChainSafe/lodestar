import { assert } from "chai";

import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {
  GENESIS_EPOCH,
  GENESIS_SLOT,
} from "../../../../src/constants";
import {
  getRandaoMix,
  getSeed,
} from "../../../../src/util";

import { generateState } from "../../../utils/state";


describe("getRandaoMix", () => {
  it("should return first randao mix for GENESIS_EPOCH", () => {
    // Empty state in 2nd epoch
    const state = generateState({
      slot: GENESIS_SLOT + config.params.SLOTS_PER_EPOCH,
      randaoMixes: [Buffer.from([0xAB]), Buffer.from([0xCD])]
    });
    const res = getRandaoMix(config, state, GENESIS_EPOCH);
    assert(Buffer.from(res as Uint8Array).equals(Uint8Array.from([0xAB])));
  });
  it("should return second randao mix for GENESIS_EPOCH + 1", () => {
    // Empty state in 2nd epoch
    const state = generateState({
      slot: GENESIS_SLOT + config.params.SLOTS_PER_EPOCH * 2,
      randaoMixes: [Buffer.from([0xAB]), Buffer.from([0xCD]), Buffer.from([0xEF])]
    });
    const res = getRandaoMix(config, state, GENESIS_EPOCH + 1);
    assert(Buffer.from(res as Uint8Array).equals(Uint8Array.from([0xCD])));
  });
});
