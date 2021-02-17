import {phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/minimal";

import {StateContextCache} from "../../../../src/chain/stateCache";
import {generateCachedState} from "../../../utils/state";
import {ZERO_HASH} from "../../../../src/constants";

describe("StateContextCache", function () {
  let cache: StateContextCache;

  beforeEach(function () {
    // max 2 items
    cache = new StateContextCache(2);
    const state1 = generateCachedState({slot: 0});
    const epochCtx1 = new phase0.EpochContext(config);
    epochCtx1.currentShuffling = {epoch: 0, activeIndices: [], shuffling: [], committees: []};
    cache.add({state: state1, epochCtx: epochCtx1});
    const state2 = generateCachedState({slot: 1 * config.params.SLOTS_PER_EPOCH});
    const epochCtx2 = new phase0.EpochContext(config);
    epochCtx2.currentShuffling = {epoch: 1, activeIndices: [], shuffling: [], committees: []};
    cache.add({state: state2, epochCtx: epochCtx2});
  });

  it("should prune", function () {
    expect(cache.size).to.be.equal(2);
    const state3 = generateCachedState({slot: 2 * config.params.SLOTS_PER_EPOCH});
    const epochCtx3 = new phase0.EpochContext(config);
    epochCtx3.currentShuffling = {epoch: 2, activeIndices: [], shuffling: [], committees: []};

    cache.add({state: state3, epochCtx: epochCtx3});
    expect(cache.size).to.be.equal(3);
    cache.prune(ZERO_HASH);
    expect(cache.size).to.be.equal(2);
  });

  it("should pruneFinalized", async function () {
    await cache.pruneFinalized(2);
    expect(cache.size).to.be.equal(0);
  });
});
