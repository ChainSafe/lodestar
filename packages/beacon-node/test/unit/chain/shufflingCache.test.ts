/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {describe, it, expect, beforeEach} from "vitest";

import {getShufflingDecisionBlock} from "@lodestar/state-transition";
// eslint-disable-next-line import/no-relative-packages
import {generateTestCachedBeaconStateOnlyValidators} from "../../../../state-transition/test/perf/util.js";
import {ShufflingCache} from "../../../src/chain/shufflingCache.js";

describe("ShufflingCache", function () {
  const vc = 64;
  const stateSlot = 100;
  const state = generateTestCachedBeaconStateOnlyValidators({vc, slot: stateSlot});
  const currentEpoch = state.epochCtx.epoch;
  const nextEpoch = state.epochCtx.nextEpoch;
  let shufflingCache: ShufflingCache;

  beforeEach(() => {
    shufflingCache = new ShufflingCache(null, {maxShufflingCacheEpochs: 1});
    shufflingCache.set(state.epochCtx.currentShuffling, state.epochCtx.currentDecisionRoot);
  });

  it("should get shuffling from cache", async function () {
    const decisionRoot = getShufflingDecisionBlock(state, currentEpoch);
    expect(await shufflingCache.get(currentEpoch, decisionRoot)).toEqual(state.epochCtx.currentShuffling);
  });

  it("should bound by maxSize(=1)", async function () {
    const decisionRoot = getShufflingDecisionBlock(state, currentEpoch);
    expect(await shufflingCache.get(currentEpoch, decisionRoot)).toEqual(state.epochCtx.currentShuffling);
    // insert promises at the same epoch does not prune the cache
    shufflingCache.insertPromise(currentEpoch, "0x00");
    expect(await shufflingCache.get(currentEpoch, decisionRoot)).toEqual(state.epochCtx.currentShuffling);
    // insert shufflings at other epochs does prune the cache
    shufflingCache.set(state.epochCtx.nextShuffling!, state.epochCtx.nextDecisionRoot);
    // the current shuffling is not available anymore
    expect(await shufflingCache.get(currentEpoch, decisionRoot)).toBeNull();
  });

  it("should return shuffling from promise", async function () {
    const nextDecisionRoot = getShufflingDecisionBlock(state, nextEpoch);
    shufflingCache.insertPromise(nextEpoch, nextDecisionRoot);
    const shufflingRequest0 = shufflingCache.get(nextEpoch, nextDecisionRoot);
    const shufflingRequest1 = shufflingCache.get(nextEpoch, nextDecisionRoot);
    shufflingCache.set(state.epochCtx.nextShuffling!, state.epochCtx.nextDecisionRoot);
    expect(await shufflingRequest0).toEqual(state.epochCtx.nextShuffling!);
    expect(await shufflingRequest1).toEqual(state.epochCtx.nextShuffling!);
  });

  it("should support up to 4 promises at a time", async function () {
    // insert 2 promises at the same epoch
    shufflingCache.insertPromise(currentEpoch, "0x00");
    shufflingCache.insertPromise(currentEpoch, "0x01");
    shufflingCache.insertPromise(currentEpoch, "0x02");
    shufflingCache.insertPromise(currentEpoch, "0x03");
    // inserting other promise should throw error
    expect(() => shufflingCache.insertPromise(currentEpoch, "0x04")).toThrow();
  });
});
