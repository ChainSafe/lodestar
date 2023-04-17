import {expect} from "chai";
import {EpochShuffling} from "@lodestar/state-transition";
import {toHexString} from "@chainsafe/ssz";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Root} from "@lodestar/types";
import {StateContextCache} from "../../../../src/chain/stateCache/index.js";
import {generateCachedState} from "../../../utils/state.js";
import {ZERO_HASH} from "../../../../src/constants/index.js";

describe("StateContextCache", function () {
  let cache: StateContextCache;
  let key1: Root, key2: Root;
  const shuffling: EpochShuffling = {
    epoch: 0,
    activeIndices: [],
    shuffling: [],
    committees: [],
    committeesPerSlot: 1,
  };

  beforeEach(function () {
    // max 2 items
    cache = new StateContextCache({maxStates: 2});
    const state1 = generateCachedState({slot: 0});
    key1 = state1.hashTreeRoot();
    state1.epochCtx.currentShuffling = {...shuffling, epoch: 0};
    cache.add(state1);
    const state2 = generateCachedState({slot: 1 * SLOTS_PER_EPOCH});
    key2 = state2.hashTreeRoot();
    state2.epochCtx.currentShuffling = {...shuffling, epoch: 1};
    cache.add(state2);
  });

  it("should prune", function () {
    expect(cache.size).to.be.equal(2, "Size must be same as initial 2");
    const state3 = generateCachedState({slot: 2 * SLOTS_PER_EPOCH});
    state3.epochCtx.currentShuffling = {...shuffling, epoch: 2};

    cache.add(state3);
    expect(cache.size).to.be.equal(3, "Size must be 2+1 after .add()");
    cache.prune(toHexString(ZERO_HASH));
    expect(cache.size).to.be.equal(2, "Size should reduce to initial 2 after prunning");
    expect(cache.get(toHexString(key1)), "must have key1").to.be.not.undefined;
    expect(cache.get(toHexString(key2)), "must have key2").to.be.not.undefined;
  });

  it("should deleteAllBeforeEpoch", function () {
    cache.deleteAllBeforeEpoch(2);
    expect(cache.size).to.be.equal(0, "size must be 0 after delete all");
  });
});
