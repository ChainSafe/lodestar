import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import {config} from "@lodestar/config/default";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Clock, ClockEvent} from "../../../src/util/clock.js";
import {MAXIMUM_GOSSIP_CLOCK_DISPARITY_MS} from "../../../src/constants/index.js";

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
    const testCases: {
      past: number;
      future: number;
      clockTime: number;
      slot: number;
      expected: boolean;
    }[] = [
      {past: 0, future: 0, clockTime: slotTimeMs(10.5), slot: 10, expected: true},
      {past: 500, future: 500, clockTime: slotTimeMs(10.5), slot: 10, expected: true},
      {past: 0, future: 500, clockTime: slotTimeMs(11) + 500, slot: 10, expected: false},
      {past: 0, future: 500, clockTime: slotTimeMs(11) + 499, slot: 10, expected: true},
      {past: 0, future: 500, clockTime: slotTimeMs(11) + 500, slot: 10, expected: false},
      {past: 500, future: 0, clockTime: slotTimeMs(10) - 500, slot: 10, expected: true},
      {past: 500, future: 0, clockTime: slotTimeMs(10) - 501, slot: 10, expected: false},
      {past: 500, future: 0, clockTime: slotTimeMs(10) - 501, slot: 10, expected: false},
    ];

    for (const {past, future, clockTime, slot, expected} of testCases) {
      it(`should return ${expected} at clockTime=${clockTime} for slot=${slot} with given \t <- ${past}\t| ${slot}(${
        slot * config.SECONDS_PER_SLOT * 1000
      }-${(slot + 1) * config.SECONDS_PER_SLOT * 1000 - 1}) |\t${future} ->`, () => {
        vi.advanceTimersByTime(clockTime);

        expect(clock.isCurrentSlotGivenTolerance(slot, past, future)).toBe(expected);
      });
    }
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
      vi.advanceTimersByTime(config.SECONDS_PER_SLOT * 1000 - (MAXIMUM_GOSSIP_CLOCK_DISPARITY_MS - 50));
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
      vi.advanceTimersByTime(config.SECONDS_PER_SLOT * 1000 - (MAXIMUM_GOSSIP_CLOCK_DISPARITY_MS - 50));
      // "current slot could be next slot if it's too close to next slot"
      expect(clock.isCurrentSlotGivenGossipDisparity(nextSlot)).toBe(true);
    });

    it("should accept previous slot if it's just passed current slot", () => {
      const previousSlot = clock.currentSlot - 1;
      vi.advanceTimersByTime(MAXIMUM_GOSSIP_CLOCK_DISPARITY_MS - 50);
      // "current slot could be previous slot if it's just passed to a slot"
      expect(clock.isCurrentSlotGivenGossipDisparity(previousSlot)).toBe(true);
      vi.advanceTimersByTime(100);
      // "current slot could NOT be previous slot if it's far away from previous slot"
      expect(clock.isCurrentSlotGivenGossipDisparity(previousSlot)).toBe(false);
    });
  });
});
