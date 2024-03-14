import {toHexString} from "@chainsafe/ssz";
import {describe, it, expect, beforeEach} from "vitest";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Root} from "@lodestar/types";
import {StateContextCache} from "../../../../src/chain/stateCache/index.js";
import {generateCachedState} from "../../../utils/state.js";
import {ZERO_HASH} from "../../../../src/constants/index.js";

describe("StateContextCache", function () {
  let cache: StateContextCache;
  let key1: Root, key2: Root;

  beforeEach(function () {
    // max 2 items
    cache = new StateContextCache({maxStates: 2});
    const state1 = generateCachedState({slot: 0});
    key1 = state1.hashTreeRoot();
    cache.add(state1);
    const state2 = generateCachedState({slot: 1 * SLOTS_PER_EPOCH});
    key2 = state2.hashTreeRoot();
    cache.add(state2);
  });

  it("should prune", function () {
    expect(cache.size).toBe(2);
    const state3 = generateCachedState({slot: 2 * SLOTS_PER_EPOCH});

    cache.add(state3);
    expect(cache.size).toBe(3);
    cache.prune(toHexString(ZERO_HASH));
    expect(cache.size).toBe(2);
    // "must have key1"
    expect(cache.get(toHexString(key1))).toBeDefined();
    // "must have key2"
    expect(cache.get(toHexString(key2))).toBeDefined();
  });

  it("should deleteAllBeforeEpoch", function () {
    cache.deleteAllBeforeEpoch(2);
    expect(cache.size).toBe(0);
  });
});
