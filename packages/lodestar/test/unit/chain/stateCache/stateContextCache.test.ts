import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/minimal";

import {StateContextCache} from "../../../../src/chain/stateCache";
import {generateCachedState} from "../../../utils/state";
import {ZERO_HASH} from "../../../../src/constants";
import {ByteVector} from "@chainsafe/ssz";

describe("StateContextCache", function () {
  let cache: StateContextCache;
  let key1: ByteVector, key2: ByteVector;

  beforeEach(function () {
    // max 2 items
    cache = new StateContextCache(2);
    const state1 = generateCachedState({slot: 0});
    key1 = state1.hashTreeRoot();
    state1.epochCtx.currentShuffling = {epoch: 0, activeIndices: [], shuffling: [], committees: []};
    cache.add(state1);
    const state2 = generateCachedState({slot: 1 * config.params.SLOTS_PER_EPOCH});
    key2 = state2.hashTreeRoot();
    state2.epochCtx.currentShuffling = {epoch: 1, activeIndices: [], shuffling: [], committees: []};
    cache.add(state2);
  });

  it("should prune", function () {
    expect(cache.size).to.be.equal(2, "Size must be same as initial 2");
    const state3 = generateCachedState({slot: 2 * config.params.SLOTS_PER_EPOCH});
    state3.epochCtx.currentShuffling = {epoch: 2, activeIndices: [], shuffling: [], committees: []};

    cache.add(state3);
    expect(cache.size).to.be.equal(3, "Size must be 2+1 after .add()");
    cache.prune(ZERO_HASH);
    expect(cache.size).to.be.equal(2, "Size should reduce to initial 2 after prunning");
    expect(cache.get(key1), "must have key1").to.be.not.undefined;
    expect(cache.get(key2), "must have key2").to.be.not.undefined;
  });

  it("should deleteAllBeforeEpoch", async function () {
    await cache.deleteAllBeforeEpoch(2);
    expect(cache.size).to.be.equal(0, "size must be 0 after delete all");
  });
});
