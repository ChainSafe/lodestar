import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import {config} from "@lodestar/config/default";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Clock, ClockEvent} from "../../../src/util/clock.js";
import {MAXIMUM_GOSSIP_CLOCK_DISPARITY} from "../../../src/constants/index.js";

function slotTimeMs(slot: number): number {
  return slot * config.SECONDS_PER_SLOT * 1000;
}

describe("Clock", () => {
  let abortController: AbortController;
  let clock: Clock;

  beforeEach(() => {
    const now = 0;
    vi.useFakeTimers({now});
    abortController = new AbortController();
    clock = new Clock({
      config,
      genesisTime: Math.floor(now / 1000),
      signal: abortController.signal,
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
    abortController.abort();
  });

  describe("isCurrentSlotGivenDisparity", () => {
    it("should return true if disparity set to zero for current slot", () => {
      vi.advanceTimersByTime(slotTimeMs(10.5));

      expect(clock.isCurrentSlotGivenDisparity(10, 0, 0)).toBe(true);
    });

    it("should return true for if slot in the middle of slot time and not in disparity range", () => {
      vi.advanceTimersByTime(slotTimeMs(10.5));

      expect(clock.isCurrentSlotGivenDisparity(10, 500, 500)).toBe(true);
    });

    it("should return true if slot within in the future disparity range", () => {
      vi.advanceTimersByTime(slotTimeMs(11) + 499);

      expect(clock.isCurrentSlotGivenDisparity(10, 0, 500)).toBe(true);
    });

    it("should return false if slot not in the future disparity range", () => {
      vi.advanceTimersByTime(slotTimeMs(11) + 500);

      expect(clock.isCurrentSlotGivenDisparity(10, 0, 500)).toBe(false);
    });

    it("should return true if slot within the past disparity range", () => {
      vi.advanceTimersByTime(slotTimeMs(10) - 499);

      expect(clock.isCurrentSlotGivenDisparity(10, 500, 0)).toBe(true);
    });

    it("should return false if slot not in the past disparity range", () => {
      vi.advanceTimersByTime(slotTimeMs(10) - 500);

      expect(clock.isCurrentSlotGivenDisparity(10, 500, 0)).toBe(false);
    });

    it("should return true if slot within in the future disparity range with single parameter", () => {
      vi.advanceTimersByTime(slotTimeMs(11) + 499);

      expect(clock.isCurrentSlotGivenDisparity(10, 500)).toBe(true);
    });
  });

  describe("waitForSlot", () => {
    it("should resolve if slot is current", async () => {
      const slot = clock.currentSlot;
      await expect(clock.waitForSlot(slot)).resolves.toBeUndefined();
    });

    it("should resolve if slot is in the past", async () => {
      const slot = clock.currentSlot - 1;
      await expect(clock.waitForSlot(slot)).resolves.toBeUndefined();
    });

    it("should wait if the slot is in the future", async () => {
      const slot = clock.currentSlot + 1;
      const promise = clock.waitForSlot(slot);

      vi.advanceTimersByTime(config.SECONDS_PER_SLOT * 1000);
      await expect(promise).resolves.toBeUndefined();
    });
  });

  describe("currentSlot", () => {
    it("should return zero on genesis time", () => {
      expect(clock.currentSlot).toBe(0);
    });

    it("should return 1 after after one slot tick", () => {
      vi.advanceTimersByTime(config.SECONDS_PER_SLOT * 1000);
      expect(clock.currentSlot).toBe(1);
    });
  });

  describe("events", () => {
    it("Should notify on new slot", () => {
      const spy = vi.fn();
      const currentSlot = clock.currentSlot;
      clock.on(ClockEvent.slot, spy);

      vi.advanceTimersByTime(config.SECONDS_PER_SLOT * 1000);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toBeCalledWith(currentSlot + 1);
    });

    it("Should notify on new epoch", () => {
      const spy = vi.fn();
      clock.on(ClockEvent.epoch, spy);
      vi.advanceTimersByTime(SLOTS_PER_EPOCH * config.SECONDS_PER_SLOT * 1000);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toBeCalledWith(clock.currentEpoch);
    });
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
