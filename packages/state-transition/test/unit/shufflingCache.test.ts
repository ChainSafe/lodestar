import {describe, it, expect} from "vitest";
import {generateTestCachedBeaconStateOnlyValidators} from "../perf/util.js";
import {
  ShufflingCache,
  ShufflingCacheItem,
  ShufflingCacheItemType,
  ShufflingResolution,
} from "../../src/cache/shufflingCache.js";

function allShufflingItems(c: ShufflingCache): ShufflingCacheItem[] {
  return Array.from(c["itemsByDecisionRootByEpoch"].values()).flatMap((innerMap) => Array.from(innerMap.values()));
}

function countPromises(cache: ShufflingCache): number {
  return allShufflingItems(cache).filter((item) => item.type === ShufflingCacheItemType.promise).length;
}

function countShufflings(cache: ShufflingCache): number {
  return allShufflingItems(cache).filter((item) => item.type === ShufflingCacheItemType.shuffling).length;
}

describe("ShufflingCache", function () {
  const vc = 64;
  const stateSlot = 100;
  const state = generateTestCachedBeaconStateOnlyValidators({vc, slot: stateSlot});
  const currentEpoch = state.epochCtx.epoch;

  it("should get shuffling from cache", async function () {
    const shufflingCache = new ShufflingCache();
    const shuffling = shufflingCache.buildSync(
      state,
      state.epochCtx.epoch,
      state.epochCtx.currentShufflingDecisionRoot,
      state.epochCtx.currentActiveIndices
    );
    expect(shufflingCache.getOrNull(currentEpoch, state.epochCtx.currentShufflingDecisionRoot)).toEqual(shuffling);
  });

  it("should bound by maxSize(=1)", async function () {
    const shufflingCache = new ShufflingCache(null, {maxShufflingCacheEpochs: 1});
    const currentShuffling = shufflingCache.buildSync(
      state,
      state.epochCtx.epoch,
      state.epochCtx.currentShufflingDecisionRoot,
      state.epochCtx.currentActiveIndices
    );
    expect(shufflingCache.getOrNull(currentEpoch, state.epochCtx.currentShufflingDecisionRoot)).toEqual(
      currentShuffling
    );

    const nextShuffling = shufflingCache.buildSync(
      state,
      state.epochCtx.nextEpoch,
      state.epochCtx.nextShufflingDecisionRoot,
      state.epochCtx.nextActiveIndices
    );
    // insert shuffling at another epoch to prune the cache
    expect(shufflingCache.getOrNull(state.epochCtx.nextEpoch, state.epochCtx.nextShufflingDecisionRoot)).toEqual(
      nextShuffling
    );
    // the current shuffling is not available anymore
    expect(shufflingCache.getOrNull(currentEpoch, state.epochCtx.currentShufflingDecisionRoot)).toBeNull();
  });

  it("should return shuffling from promise correctly", async function () {
    const shufflingCache = new ShufflingCache();

    /* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
    const resolveFn: ShufflingResolution = (shufflingCache as any)._insertShufflingPromise(
      state.epochCtx.epoch,
      state.epochCtx.currentShufflingDecisionRoot
    );
    /* eslint-enable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */

    expect(countPromises(shufflingCache)).toEqual(1);
    const shufflingRequest0 = shufflingCache.get(state.epochCtx.epoch, state.epochCtx.currentShufflingDecisionRoot);
    expect(shufflingRequest0).toBeInstanceOf(Promise);
    const shufflingRequest1 = shufflingCache.get(state.epochCtx.epoch, state.epochCtx.currentShufflingDecisionRoot);
    expect(shufflingRequest1).toBeInstanceOf(Promise);

    const DELAY_WAIT_TIME = 2000;
    const race = await Promise.race([
      new Promise<string>((resolve) => setTimeout(() => resolve("delay"), DELAY_WAIT_TIME)),
      shufflingRequest0,
      shufflingRequest1,
    ]);
    expect(typeof race).toEqual("string");
    expect(race).toEqual("delay");

    // double check delay is less than a quarter of the wait time so we are sure its actually waiting
    // for the inserted promises above
    const startTime = Date.now();
    const shuffling = shufflingCache.buildSync(
      state,
      state.epochCtx.epoch,
      state.epochCtx.currentShufflingDecisionRoot,
      state.epochCtx.currentActiveIndices
    );
    const endTime = Date.now();
    expect(endTime - startTime).toBeLessThan(DELAY_WAIT_TIME / 4);

    const [result0, result1] = await Promise.all([shufflingRequest0, shufflingRequest1]);
    expect(result0).toEqual(shuffling);
    expect(result1).toEqual(shuffling);
    expect(countPromises(shufflingCache)).toEqual(0);
    expect(countShufflings(shufflingCache)).toEqual(1);

    // double check that re-resolving for thrown away promises does not change the result
    resolveFn("bad data" as any);
    expect(result1).toEqual(shuffling);
  });

  it("should support up to 2 promises at a time", async function () {
    const shufflingCache = new ShufflingCache();
    /* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
    (shufflingCache as any)._insertShufflingPromise(state.epochCtx.epoch, state.epochCtx.currentShufflingDecisionRoot);
    expect(countPromises(shufflingCache)).toEqual(1);
    (shufflingCache as any)._insertShufflingPromise(state.epochCtx.nextEpoch, state.epochCtx.nextShufflingDecisionRoot);
    expect(countPromises(shufflingCache)).toEqual(2);
    expect(() =>
      (shufflingCache as any)._insertShufflingPromise(
        state.epochCtx.nextEpoch,
        state.epochCtx.nextShufflingDecisionRoot
      )
    ).toThrow();
    /* eslint-enable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
  });
});
