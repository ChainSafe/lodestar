import {expect} from "chai";
import {allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {StateContextCache} from "../../../../src/chain/stateCache";
import {generateCachedState} from "../../../utils/state";
import {ZERO_HASH} from "../../../../src/constants";
import {ByteVector, toHexString} from "@chainsafe/ssz";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";

describe("StateContextCache", function () {
  let cache: StateContextCache;
  let key1: ByteVector, key2: ByteVector;
  const shuffling: allForks.IEpochShuffling = {
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

  it("should deleteAllBeforeEpoch", async function () {
    await cache.deleteAllBeforeEpoch(2);
    expect(cache.size).to.be.equal(0, "size must be 0 after delete all");
  });
});
