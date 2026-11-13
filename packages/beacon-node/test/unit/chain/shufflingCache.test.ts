import {beforeEach, describe, expect, it, vi} from "vitest";
import {BeaconStateView, EpochShuffling} from "@lodestar/state-transition";
import {generateTestCachedBeaconStateOnlyValidators} from "@lodestar/state-transition/test-utils";
import {ShufflingCache, ShufflingPromiseCancelReason} from "../../../src/chain/shufflingCache.js";

describe("ShufflingCache", () => {
  const vc = 64;
  const stateSlot = 100;
  const state = generateTestCachedBeaconStateOnlyValidators({vc, slot: stateSlot});
  const currentEpoch = state.epochCtx.epoch;
  const currentDecisionRoot = state.epochCtx.currentDecisionRoot;
  let shufflingCache: ShufflingCache;

  function shufflingAtEpoch(epoch: number): EpochShuffling {
    return {...state.epochCtx.currentShuffling, epoch};
  }

  beforeEach(() => {
    shufflingCache = new ShufflingCache(null, null, {maxShufflingCacheEpochs: 1}, [
      {
        shuffling: state.epochCtx.currentShuffling,
        decisionRoot: currentDecisionRoot,
      },
    ]);
  });

  it("should get shuffling from cache", async () => {
    expect(await shufflingCache.get(currentEpoch, currentDecisionRoot)).toEqual(state.epochCtx.currentShuffling);
  });

  it("processState should not materialize already cached shufflings", () => {
    const stateView = new BeaconStateView(state);
    shufflingCache = new ShufflingCache(null, null, {maxShufflingCacheEpochs: 4}, [
      {
        shuffling: state.epochCtx.previousShuffling,
        decisionRoot: state.epochCtx.previousDecisionRoot,
      },
      {
        shuffling: state.epochCtx.currentShuffling,
        decisionRoot: state.epochCtx.currentDecisionRoot,
      },
      {
        shuffling: state.epochCtx.nextShuffling,
        decisionRoot: state.epochCtx.nextDecisionRoot,
      },
    ]);

    const previousSpy = vi.spyOn(stateView, "getPreviousShuffling");
    const currentSpy = vi.spyOn(stateView, "getCurrentShuffling");
    const nextSpy = vi.spyOn(stateView, "getNextShuffling");

    shufflingCache.processState(stateView);

    expect(previousSpy).not.toHaveBeenCalled();
    expect(currentSpy).not.toHaveBeenCalled();
    expect(nextSpy).not.toHaveBeenCalled();
  });

  it("should bound by maxSize(=1)", async () => {
    expect(await shufflingCache.get(currentEpoch, currentDecisionRoot)).toEqual(state.epochCtx.currentShuffling);
    // insert promises at the same epoch does not prune the cache
    shufflingCache.insertPromise(currentEpoch, "0x00");
    expect(await shufflingCache.get(currentEpoch, currentDecisionRoot)).toEqual(state.epochCtx.currentShuffling);
    // insert shuffling at an older epoch prunes itself
    shufflingCache["set"](state.epochCtx.previousShuffling, state.epochCtx.previousDecisionRoot);
    expect(await shufflingCache.get(currentEpoch, currentDecisionRoot)).toEqual(state.epochCtx.currentShuffling);
    expect(await shufflingCache.get(currentEpoch - 1, state.epochCtx.previousDecisionRoot)).toBeNull();
    // insert shuffling at a newer epoch prunes the current epoch
    shufflingCache["set"](shufflingAtEpoch(currentEpoch + 1), "0x01");
    expect(await shufflingCache.get(currentEpoch, currentDecisionRoot)).toBeNull();
  });

  it("should prune the smallest epochs, not the first inserted ones", () => {
    shufflingCache = new ShufflingCache(null, null, {maxShufflingCacheEpochs: 4});
    const epoch = 10;
    for (const e of [epoch - 2, epoch - 1, epoch, epoch + 1]) {
      shufflingCache["set"](shufflingAtEpoch(e), "0xcanonical");
    }

    // processState of a side-fork state of an older epoch inserts its previous, current and next shufflings
    for (const e of [epoch - 3, epoch - 2, epoch - 1]) {
      shufflingCache["set"](shufflingAtEpoch(e), "0xfork");
    }

    for (const e of [epoch - 2, epoch - 1, epoch, epoch + 1]) {
      expect(shufflingCache.getSync(e, "0xcanonical"), `epoch ${e}`).not.toBeNull();
    }
    expect(shufflingCache.getSync(epoch - 3, "0xfork")).toBeNull();
  });

  it("should not create epochs when reading", () => {
    shufflingCache = new ShufflingCache(null, null, {maxShufflingCacheEpochs: 2});
    shufflingCache["set"](shufflingAtEpoch(10), "0x00");
    shufflingCache["set"](shufflingAtEpoch(11), "0x00");

    expect(shufflingCache.getSync(20, "0x00")).toBeNull();
    expect(shufflingCache.has(21, "0x00")).toBe(false);
    shufflingCache["set"](shufflingAtEpoch(11), "0x01");

    expect(shufflingCache.getSync(10, "0x00")).not.toBeNull();
    expect(shufflingCache.getSync(11, "0x01")).not.toBeNull();
  });

  it("processState should resolve a pending promise", async () => {
    shufflingCache = new ShufflingCache(null, null, {maxShufflingCacheEpochs: 4});
    shufflingCache.insertPromise(currentEpoch, currentDecisionRoot);
    const shufflingRequest = shufflingCache.get(currentEpoch, currentDecisionRoot);

    shufflingCache.processState(new BeaconStateView(state));

    expect(await shufflingRequest).toEqual(state.epochCtx.currentShuffling);
    expect(shufflingCache.getSync(currentEpoch, currentDecisionRoot)).toEqual(state.epochCtx.currentShuffling);
  });

  it("cancelPromise should resolve waiters with null and remove the promise", async () => {
    shufflingCache.insertPromise(currentEpoch, "0x00");
    shufflingCache.insertPromise(currentEpoch, "0x01");
    const shufflingRequest = shufflingCache.get(currentEpoch, "0x00");

    shufflingCache.cancelPromise(currentEpoch, "0x00", ShufflingPromiseCancelReason.regenError);

    expect(await shufflingRequest).toBeNull();
    expect(await shufflingCache.get(currentEpoch, "0x00")).toBeNull();
    // the cancelled promise does not count toward the max promises anymore
    expect(() => shufflingCache.insertPromise(currentEpoch, "0x02")).not.toThrow();
  });

  it("pruning an epoch should resolve its pending promises with null", async () => {
    shufflingCache.insertPromise(currentEpoch, "0x00");
    const shufflingRequest = shufflingCache.get(currentEpoch, "0x00");

    shufflingCache["set"](shufflingAtEpoch(currentEpoch + 1), "0x01");

    expect(await shufflingRequest).toBeNull();
  });

  it("should return shuffling from promise", async () => {
    const previousEpoch = state.epochCtx.epoch - 1;
    const previousDecisionRoot = state.epochCtx.previousDecisionRoot;
    shufflingCache.insertPromise(previousEpoch, previousDecisionRoot);
    const shufflingRequest0 = shufflingCache.get(previousEpoch, previousDecisionRoot);
    const shufflingRequest1 = shufflingCache.get(previousEpoch, previousDecisionRoot);
    shufflingCache["set"](state.epochCtx.previousShuffling, previousDecisionRoot);
    expect(await shufflingRequest0).toEqual(state.epochCtx.previousShuffling);
    expect(await shufflingRequest1).toEqual(state.epochCtx.previousShuffling);
  });

  it("should support up to 2 promises at a time", async () => {
    // insert 2 promises at the same epoch
    shufflingCache.insertPromise(currentEpoch, "0x00");
    shufflingCache.insertPromise(currentEpoch, "0x01");
    // inserting other promise should throw error
    expect(() => shufflingCache.insertPromise(currentEpoch, "0x02")).toThrow();
  });
});
