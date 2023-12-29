import {describe, it, expect, beforeEach} from "vitest";
import {toHexString} from "@chainsafe/ssz";
import {EpochShuffling} from "@lodestar/state-transition";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition/src/types.js";
import {FIFOBlockStateCache} from "../../../../src/chain/stateCache/index.js";
import {generateCachedState} from "../../../utils/state.js";

describe("FIFOBlockStateCache", function () {
  let cache: FIFOBlockStateCache;
  const shuffling: EpochShuffling = {
    epoch: 0,
    activeIndices: [],
    shuffling: [],
    committees: [],
    committeesPerSlot: 1,
  };

  const state1 = generateCachedState({slot: 0});
  const key1 = toHexString(state1.hashTreeRoot());
  state1.epochCtx.currentShuffling = {...shuffling, epoch: 0};

  const state2 = generateCachedState({slot: 1 * SLOTS_PER_EPOCH});
  const key2 = toHexString(state2.hashTreeRoot());
  state2.epochCtx.currentShuffling = {...shuffling, epoch: 1};

  const state3 = generateCachedState({slot: 2 * SLOTS_PER_EPOCH});
  const key3 = toHexString(state3.hashTreeRoot());
  state3.epochCtx.currentShuffling = {...shuffling, epoch: 2};

  beforeEach(function () {
    // max 2 items
    cache = new FIFOBlockStateCache({maxBlockStates: 2}, {});
    cache.add(state1);
    cache.add(state2);
  });

  const testCases: {
    name: string;
    headState: CachedBeaconStateAllForks;
    addAsHeadArr: boolean[];
    keptStates: string[];
    prunedState: string;
  }[] = [
    {
      name: "add as head, prune key1",
      headState: state2,
      addAsHeadArr: [true],
      keptStates: [key3, key2],
      prunedState: key1,
    },
    {
      name: "add, prune key1",
      headState: state2,
      addAsHeadArr: [false],
      keptStates: [key2, key3],
      prunedState: key1,
    },
    {
      name: "add as head, prune key2",
      headState: state1,
      addAsHeadArr: [true],
      keptStates: [key3, key1],
      prunedState: key2,
    },
    {
      name: "add, prune key2",
      headState: state1,
      addAsHeadArr: [false],
      keptStates: [key1, key3],
      prunedState: key2,
    },
    // same flow to importBlock
    {
      name: "add then set as head, prune key1",
      headState: state2,
      addAsHeadArr: [false, true],
      keptStates: [key3, key2],
      prunedState: key1,
    },
    {
      name: "add then set as head, prune key2",
      headState: state1,
      addAsHeadArr: [false, true],
      keptStates: [key3, key1],
      prunedState: key2,
    },
  ];

  for (const {name, headState, addAsHeadArr, keptStates, prunedState} of testCases) {
    it(name, () => {
      // move to head this state
      cache.setHeadState(headState);
      expect(cache.size).to.be.equal(2, "Size must be same as initial 2");
      for (const addAsHead of addAsHeadArr) {
        cache.add(state3, addAsHead);
      }
      expect(cache.size).to.be.equal(2, "Size should reduce to initial 2 after prunning");
      expect(cache.dumpKeyOrder()).toEqual(keptStates);
      expect(cache.get(prunedState)).toBeNull();
      for (const key of keptStates) {
        expect(cache.get(key), `must have key ${key}`).to.be.not.null;
      }
    });
  }

  it("Should not prune newly added state", () => {
    cache = new FIFOBlockStateCache({maxBlockStates: 1}, {});
    cache.setHeadState(state1);
    // Size must be same as initial 1
    expect(cache.size).toEqual(1);
    cache.add(state2);
    // Should not deleted newly added state
    expect(cache.size).toEqual(2);
    cache.add(state3);
    // Should delete 1 state
    expect(cache.size).toEqual(2);
    expect(cache.dumpKeyOrder()).toEqual([key1, key3]);
  });
});
