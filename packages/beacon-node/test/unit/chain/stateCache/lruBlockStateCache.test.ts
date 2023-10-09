import {expect} from "chai";
import {toHexString} from "@chainsafe/ssz";
import {EpochShuffling} from "@lodestar/state-transition";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Root} from "@lodestar/types";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition/src/types.js";
import {LRUBlockStateCache} from "../../../../src/chain/stateCache/index.js";
import {generateCachedState} from "../../../utils/state.js";

describe("LRUBlockStateCache", function () {
  let cache: LRUBlockStateCache;
  const shuffling: EpochShuffling = {
    epoch: 0,
    activeIndices: [],
    shuffling: [],
    committees: [],
    committeesPerSlot: 1,
  };

  const state1 = generateCachedState({slot: 0});
  const key1 = state1.hashTreeRoot();
  state1.epochCtx.currentShuffling = {...shuffling, epoch: 0};

  const state2 = generateCachedState({slot: 1 * SLOTS_PER_EPOCH});
  const key2 = state2.hashTreeRoot();
  state2.epochCtx.currentShuffling = {...shuffling, epoch: 1};

  const state3 = generateCachedState({slot: 2 * SLOTS_PER_EPOCH});
  const key3 = state3.hashTreeRoot();
  state3.epochCtx.currentShuffling = {...shuffling, epoch: 2};

  beforeEach(function () {
    // max 2 items
    cache = new LRUBlockStateCache({maxStates: 2}, {});
    cache.add(state1);
    cache.add(state2);
  });

  const pruneTestCases: {
    name: string;
    lastAddedState: CachedBeaconStateAllForks;
    keptStates: Root[];
    prunedStates: Root[];
  }[] = [
    {
      name: "should prune key1",
      lastAddedState: state2,
      keptStates: [key3, key2],
      prunedStates: [key1],
    },
    {
      name: "should prune key2",
      lastAddedState: state1,
      keptStates: [key3, key1],
      prunedStates: [key2],
    },
  ];

  for (const {name, lastAddedState, keptStates, prunedStates} of pruneTestCases) {
    it(name, () => {
      // move to head this state
      cache.add(lastAddedState);
      expect(cache.size).to.be.equal(2, "Size must be same as initial 2");
      expect(cache.size).to.be.equal(2, "Size should reduce to initial 2 after prunning");
      cache.add(state3);
      for (const key of keptStates) {
        expect(cache.get(toHexString(key)), `must have key ${toHexString(key)}`).to.be.not.null;
      }
      for (const key of prunedStates) {
        expect(cache.get(toHexString(key)), `must not have key ${toHexString(key)}`).to.be.null;
      }
    });
  }

  it("should deleteAllBeforeEpoch", function () {
    cache.deleteAllBeforeEpoch(2);
    expect(cache.size).to.be.equal(0, "size must be 0 after delete all");
  });
});
