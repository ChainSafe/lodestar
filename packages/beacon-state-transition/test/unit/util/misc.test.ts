import {assert} from "chai";

import {GENESIS_SLOT, SLOTS_PER_HISTORICAL_ROOT} from "@chainsafe/lodestar-params";
import {toBigIntLE} from "bigint-buffer";
import {getBlockRoot} from "../../../src/util/index.js";
import {generateState} from "../../utils/state.js";

describe("getBlockRoot", () => {
  it("should return first block root for genesis slot", () => {
    const state = generateState({
      slot: GENESIS_SLOT + 1,
      blockRoots: Array.from({length: SLOTS_PER_HISTORICAL_ROOT}, () => Buffer.from([0xab])),
    });
    const res = Buffer.from(getBlockRoot(state, GENESIS_SLOT) as Uint8Array);
    const expectedRes = BigInt("0xab");
    assert(toBigIntLE(res) === expectedRes, `got: ${toBigIntLE(res)}, expected: ${expectedRes.toString(16)}`);
  });
  it("should fail if slot is current slot", () => {
    const state = generateState({slot: GENESIS_SLOT});
    assert.throws(() => getBlockRoot(state, GENESIS_SLOT), "");
  });
  it("should fail if slot is not within SLOTS_PER_HISTORICAL_ROOT of current slot", () => {
    const state = generateState({slot: GENESIS_SLOT + SLOTS_PER_HISTORICAL_ROOT + 1});
    assert.throws(() => getBlockRoot(state, GENESIS_SLOT), "");
  });
});
