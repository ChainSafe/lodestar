import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import {config} from "@lodestar/config/default";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Clock, ClockEvent} from "../../../src/util/clock.js";
import {MAXIMUM_GOSSIP_CLOCK_DISPARITY} from "../../../src/constants/index.js";

describe("Clock", () => {
  let abortController: AbortController;
  let clock: Clock;

  beforeEach(() => {
    const now = Date.now();
    vi.useFakeTimers({now: 0});
    abortController = new AbortController();
    clock = new Clock({
      config,
      genesisTime: Math.round(now / 1000),
      signal: abortController.signal,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
    abortController.abort();
  });

  // TODO: Debug why this test is fragile after migrating to vitest
  it.skip("Should notify on new slot", () => {
    const spy = vi.fn();
    clock.on(ClockEvent.slot, spy);
    vi.advanceTimersByTime(config.SECONDS_PER_SLOT * 1000);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toBeCalledWith(clock.currentSlot);
  });

  it("Should notify on new epoch", () => {
    const spy = vi.fn();
    clock.on(ClockEvent.epoch, spy);
    vi.advanceTimersByTime(SLOTS_PER_EPOCH * config.SECONDS_PER_SLOT * 1000);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toBeCalledWith(clock.currentEpoch);
  });

  describe("currentSlotWithGossipDisparity", () => {
    it("should be next slot", () => {
      vi.advanceTimersByTime(config.SECONDS_PER_SLOT * 1000 - (MAXIMUM_GOSSIP_CLOCK_DISPARITY - 50));
      expect(clock.currentSlotWithGossipDisparity).toBe(clock.currentSlot + 1);
    });

    it("should be current slot", () => {
      expect(clock.currentSlotWithGossipDisparity).toBe(clock.currentSlot);
    });
  });

  describe("isCurrentSlotGivenGossipDisparity", () => {
    it("should return true for current slot", () => {
      const currentSlot = clock.currentSlot;
      // "isCurrentSlotGivenGossipDisparity is not correct for current slot"
      expect(clock.isCurrentSlotGivenGossipDisparity(currentSlot)).toBe(true);
    });

    it("should accept next slot if it's too close to next slot", () => {
      const nextSlot = clock.currentSlot + 1;
      // "current slot could NOT be next slot if it's far away from next slot"
      expect(clock.isCurrentSlotGivenGossipDisparity(nextSlot)).toBe(false);
      vi.advanceTimersByTime(config.SECONDS_PER_SLOT * 1000 - (MAXIMUM_GOSSIP_CLOCK_DISPARITY - 50));
      // "current slot could be next slot if it's too close to next slot"
      expect(clock.isCurrentSlotGivenGossipDisparity(nextSlot)).toBe(true);
    });

    it("should accept previous slot if it's just passed current slot", () => {
      const previousSlot = clock.currentSlot - 1;
      vi.advanceTimersByTime(MAXIMUM_GOSSIP_CLOCK_DISPARITY - 50);
      // "current slot could be previous slot if it's just passed to a slot"
      expect(clock.isCurrentSlotGivenGossipDisparity(previousSlot)).toBe(true);
      vi.advanceTimersByTime(100);
      // "current slot could NOT be previous slot if it's far away from previous slot"
      expect(clock.isCurrentSlotGivenGossipDisparity(previousSlot)).toBe(false);
    });
  });
});
