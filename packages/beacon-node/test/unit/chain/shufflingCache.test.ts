import {describe, it, expect, beforeEach} from "vitest";

import {getShufflingDecisionBlock} from "@lodestar/state-transition";
// eslint-disable-next-line import/no-relative-packages
import {generateTestCachedBeaconStateOnlyValidators} from "../../../../state-transition/test/perf/util.js";
import {ShufflingCache} from "../../../src/chain/shufflingCache.js";

describe("ShufflingCache", function () {
  const vc = 64;
  const stateSlot = 100;
  const state = generateTestCachedBeaconStateOnlyValidators({vc, slot: stateSlot});
  const currentEpoch = state.epochCtx.currentShuffling.epoch;
  let shufflingCache: ShufflingCache;

  beforeEach(() => {
    shufflingCache = new ShufflingCache(null, {maxShufflingCacheEpochs: 1});
    shufflingCache.processState(state, currentEpoch);
  });

  it("should get shuffling from cache", async function () {
    const decisionRoot = getShufflingDecisionBlock(state, currentEpoch);
    expect(await shufflingCache.get(currentEpoch, decisionRoot)).to.deep.equal(state.epochCtx.currentShuffling);
  });

  it("should bound by maxSize(=1)", async function () {
    const decisionRoot = getShufflingDecisionBlock(state, currentEpoch);
    expect(await shufflingCache.get(currentEpoch, decisionRoot)).to.deep.equal(state.epochCtx.currentShuffling);
    // insert promises at the same epoch does not prune the cache
    shufflingCache.insertPromise(currentEpoch, "0x00");
    expect(await shufflingCache.get(currentEpoch, decisionRoot)).to.deep.equal(state.epochCtx.currentShuffling);
    // insert shufflings at other epochs does prune the cache
    shufflingCache.processState(state, currentEpoch + 1);
    // the current shuffling is not available anymore
    expect(await shufflingCache.get(currentEpoch, decisionRoot)).to.be.null;
  });

  it("should return shuffling from promise", async function () {
    const nextDecisionRoot = getShufflingDecisionBlock(state, currentEpoch + 1);
    shufflingCache.insertPromise(currentEpoch + 1, nextDecisionRoot);
    const shufflingRequest0 = shufflingCache.get(currentEpoch + 1, nextDecisionRoot);
    const shufflingRequest1 = shufflingCache.get(currentEpoch + 1, nextDecisionRoot);
    shufflingCache.processState(state, currentEpoch + 1);
    expect(await shufflingRequest0).to.deep.equal(state.epochCtx.nextShuffling);
    expect(await shufflingRequest1).to.deep.equal(state.epochCtx.nextShuffling);
  });

  it("should support up to 2 promises at a time", async function () {
    // insert 2 promises at the same epoch
    shufflingCache.insertPromise(currentEpoch, "0x00");
    shufflingCache.insertPromise(currentEpoch, "0x01");
    // inserting other promise should throw error
    expect(() => shufflingCache.insertPromise(currentEpoch, "0x02")).to.throw();
  });
});
