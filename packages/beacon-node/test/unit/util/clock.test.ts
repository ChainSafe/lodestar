import sinon from "sinon";
import {config} from "@lodestar/config/default";

import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Clock, ClockEvent} from "../../../src/util/clock.js";
import {MAXIMUM_GOSSIP_CLOCK_DISPARITY} from "../../../src/constants/index.js";

describe("Clock", function () {
  const sandbox = sinon.createSandbox();
  let abortController: AbortController;
  let clock: Clock;

  beforeEach(() => {
    sandbox.useFakeTimers();
    abortController = new AbortController();
    clock = new Clock({
      config,
      genesisTime: Math.round(new Date().getTime() / 1000),
      signal: abortController.signal,
    });
  });

  afterEach(() => {
    sandbox.restore();
    abortController.abort();
  });

  it("Should notify on new slot", function () {
    const spy = sinon.spy();
    clock.on(ClockEvent.slot, spy);
    sandbox.clock.tick(config.SECONDS_PER_SLOT * 1000);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.calledWith(clock.currentSlot)).toBe(true);
  });

  it("Should notify on new epoch", function () {
    const spy = sinon.spy();
    clock.on(ClockEvent.epoch, spy);
    sandbox.clock.tick(SLOTS_PER_EPOCH * config.SECONDS_PER_SLOT * 1000);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.calledWith(clock.currentEpoch)).toBe(true);
  });

  describe("currentSlotWithGossipDisparity", () => {
    it("should be next slot", () => {
      sandbox.clock.tick(config.SECONDS_PER_SLOT * 1000 - (MAXIMUM_GOSSIP_CLOCK_DISPARITY - 50));
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
      sandbox.clock.tick(config.SECONDS_PER_SLOT * 1000 - (MAXIMUM_GOSSIP_CLOCK_DISPARITY - 50));
      // "current slot could be next slot if it's too close to next slot"
      expect(clock.isCurrentSlotGivenGossipDisparity(nextSlot)).toBe(true);
    });

    it("should accept previous slot if it's just passed current slot", () => {
      const previousSlot = clock.currentSlot - 1;
      sandbox.clock.tick(MAXIMUM_GOSSIP_CLOCK_DISPARITY - 50);
      // "current slot could be previous slot if it's just passed to a slot"
      expect(clock.isCurrentSlotGivenGossipDisparity(previousSlot)).toBe(true);
      sandbox.clock.tick(100);
      // "current slot could NOT be previous slot if it's far away from previous slot"
      expect(clock.isCurrentSlotGivenGossipDisparity(previousSlot)).toBe(false);
    });
  });
});
