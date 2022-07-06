import {expect} from "chai";

import {GENESIS_EPOCH, GENESIS_SLOT, SLOTS_PER_EPOCH} from "@lodestar/params";
import {toHexString} from "@chainsafe/ssz";
import {getRandaoMix} from "../../../src/util/index.js";

import {generateState} from "../../utils/state.js";

describe("getRandaoMix", () => {
  const randaoMix1 = Buffer.alloc(32, 1);
  const randaoMix2 = Buffer.alloc(32, 2);

  it("should return first randao mix for GENESIS_EPOCH", () => {
    // Empty state in 2nd epoch
    const state = generateState({slot: GENESIS_SLOT + SLOTS_PER_EPOCH});
    state.randaoMixes.set(0, randaoMix1);

    const res = getRandaoMix(state, GENESIS_EPOCH);
    expect(toHexString(res)).to.equal(toHexString(randaoMix1));
  });
  it("should return second randao mix for GENESIS_EPOCH + 1", () => {
    // Empty state in 2nd epoch
    const state = generateState({slot: GENESIS_SLOT + SLOTS_PER_EPOCH * 2});
    state.randaoMixes.set(0, randaoMix1);
    state.randaoMixes.set(1, randaoMix2);

    const res = getRandaoMix(state, GENESIS_EPOCH + 1);
    expect(toHexString(res)).to.equal(toHexString(randaoMix2));
  });
});
