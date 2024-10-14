import {toHexString} from "@chainsafe/ssz";
import {describe, it, expect, beforeEach} from "vitest";
import {EpochShuffling} from "@lodestar/state-transition";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Root} from "@lodestar/types";
import {BlockStateCacheImpl} from "../../../../src/chain/stateCache/index.js";
import {generateCachedState} from "../../../utils/state.js";
import {ZERO_HASH} from "../../../../src/constants/index.js";

describe("BlockStateCacheImpl", () => {
  let cache: BlockStateCacheImpl;
  let key1: Root, key2: Root;
  const shuffling: EpochShuffling = {
    epoch: 0,
    activeIndices: new Uint32Array(),
    shuffling: new Uint32Array(),
    committees: [],
    committeesPerSlot: 1,
  };

  beforeEach(() => {
    // max 2 items
    cache = new BlockStateCacheImpl({maxStates: 2});
    const state1 = generateCachedState({slot: 0});
    key1 = state1.hashTreeRoot();
    state1.epochCtx.currentShuffling = {...shuffling, epoch: 0};
    cache.add(state1);
    const state2 = generateCachedState({slot: 1 * SLOTS_PER_EPOCH});
    key2 = state2.hashTreeRoot();
    state2.epochCtx.currentShuffling = {...shuffling, epoch: 1};
    cache.add(state2);
  });

  it("should prune", () => {
    expect(cache.size).toBe(2);
    const state3 = generateCachedState({slot: 2 * SLOTS_PER_EPOCH});
    state3.epochCtx.currentShuffling = {...shuffling, epoch: 2};

    cache.add(state3);
    expect(cache.size).toBe(3);
    cache.prune(toHexString(ZERO_HASH));
    expect(cache.size).toBe(2);
    // "must have key1"
    expect(cache.get(toHexString(key1))).toBeDefined();
    // "must have key2"
    expect(cache.get(toHexString(key2))).toBeDefined();
  });

  it("should deleteAllBeforeEpoch", () => {
    cache.deleteAllBeforeEpoch(2);
    expect(cache.size).toBe(0);
  });
});
