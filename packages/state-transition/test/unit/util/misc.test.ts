import {describe, it, expect} from "vitest";

import {toBigIntLE} from "bigint-buffer";
import {GENESIS_SLOT, SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {getBlockRoot} from "../../../src/util/index.js";
import {generateState} from "../../utils/state.js";

describe("getBlockRoot", () => {
  it("should return first block root for genesis slot", () => {
    const state = generateState({
      slot: GENESIS_SLOT + 1,
      blockRoots: Array.from({length: SLOTS_PER_HISTORICAL_ROOT}, () => Buffer.from([0xab])),
    });
    const res = Buffer.from(getBlockRoot(state, GENESIS_SLOT));
    const expectedRes = BigInt("0xab");
    expect(toBigIntLE(res)).toEqual(expectedRes);
  });
  it("should fail if slot is current slot", () => {
    const state = generateState({slot: GENESIS_SLOT});
    expect(() => getBlockRoot(state, GENESIS_SLOT)).toThrow("");
  });
  it("should fail if slot is not within SLOTS_PER_HISTORICAL_ROOT of current slot", () => {
    const state = generateState({slot: GENESIS_SLOT + SLOTS_PER_HISTORICAL_ROOT + 1});
    expect(() => getBlockRoot(state, GENESIS_SLOT)).toThrow("");
  });
});
