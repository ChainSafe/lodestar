import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {BeaconConfig} from "@lodestar/config";
import {config} from "@lodestar/config/default";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Clock, getCurrentSlotAround} from "../../../src/util/clock.js";
import {testLogger} from "../../utils/logger.js";

describe("util / Clock", () => {
  const logger = testLogger();
  let controller: AbortController;

  beforeEach(() => {
    controller = new AbortController();
    vi.useFakeTimers({now: Date.now()});
  });

  afterEach(() => {
    controller.abort();
    vi.useRealTimers();
  });

  it("Should call on slot", async () => {
    const genesisTime = Math.floor(Date.now() / 1000) - config.SLOT_DURATION_MS / 2000;
    const clock = new Clock(config, logger, {genesisTime});

    const onSlot = vi.fn().mockResolvedValue(undefined);
    clock.runEverySlot(onSlot);
    clock.start(controller.signal);

    // Must run once immediately
    expect(onSlot).toHaveBeenCalledOnce();
    expect(onSlot).toHaveBeenNthCalledWith(1, 0, expect.any(AbortSignal));

    await vi.advanceTimersByTimeAsync(config.SLOT_DURATION_MS);
    expect(onSlot).toHaveBeenCalledTimes(2);
    expect(onSlot).toHaveBeenNthCalledWith(2, 1, expect.any(AbortSignal));

    await vi.advanceTimersByTimeAsync(config.SLOT_DURATION_MS);
    expect(onSlot).toHaveBeenCalledTimes(3);
    expect(onSlot).toHaveBeenNthCalledWith(3, 2, expect.any(AbortSignal));
  });

  it("Should stop calling on slot after stop()", async () => {
    const genesisTime = Math.floor(Date.now() / 1000) - config.SLOT_DURATION_MS / 2000;
    const clock = new Clock(config, logger, {genesisTime});

    const onSlot = vi.fn().mockResolvedValue(undefined);
    clock.runEverySlot(onSlot);
    clock.start(controller.signal);

    await vi.advanceTimersByTimeAsync(config.SLOT_DURATION_MS);
    expect(onSlot).toBeCalledTimes(2);
    expect(onSlot).toHaveBeenNthCalledWith(2, 1, expect.any(AbortSignal));

    // Stop clock
    controller.abort();
    await vi.advanceTimersByTimeAsync(config.SLOT_DURATION_MS);
    expect(onSlot).toBeCalledTimes(2);
  });

  it("Should call on epoch", async () => {
    // Start halfway through an epoch, so advancing a slot does not cross to the next epoch
    const genesisTime = Math.floor(Date.now() / 1000) - (SLOTS_PER_EPOCH * config.SLOT_DURATION_MS) / 2000;

    const clock = new Clock(config, logger, {genesisTime});

    const onEpoch = vi.fn().mockResolvedValue(undefined);
    clock.runEveryEpoch(onEpoch);
    clock.start(controller.signal);

    // Must run once immediately
    expect(onEpoch).toHaveBeenCalledOnce();
    expect(onEpoch).toHaveBeenCalledWith(0, expect.any(AbortSignal));

    await vi.advanceTimersByTimeAsync(config.SLOT_DURATION_MS);
    expect(onEpoch).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(SLOTS_PER_EPOCH * config.SLOT_DURATION_MS);
    expect(onEpoch).toHaveBeenCalledTimes(2);
    expect(onEpoch).toHaveBeenNthCalledWith(2, 1, expect.any(AbortSignal));
  });

  it("Should skip slots when tasks take longer than one slot to run", async () => {
    const genesisTime = Math.floor(Date.now() / 1000) - config.SLOT_DURATION_MS / 2000;
    const clock = new Clock(config, logger, {genesisTime, skipSlots: true});

    const slotsCalled: number[] = [];
    const onSlot = vi.fn().mockImplementation(async (slot: number) => {
      slotsCalled.push(slot);
      // First task takes longer than a slot
      if (slot === 0) {
        await new Promise((resolve) => setTimeout(resolve, config.SLOT_DURATION_MS + 100));
      }
    });

    clock.runEverySlot(onSlot);
    clock.start(controller.signal);

    // Must run once immediately
    expect(onSlot).toHaveBeenCalledOnce();
    expect(onSlot).toHaveBeenNthCalledWith(1, 0, expect.any(AbortSignal));
    expect(slotsCalled).toEqual([0]);

    // Advance time to slot 2
    await vi.advanceTimersByTimeAsync(config.SLOT_DURATION_MS * 2 + 200);

    // Slot 1 should be skipped and we should be on slot 2
    expect(onSlot).toHaveBeenCalledTimes(2);
    expect(onSlot).toHaveBeenNthCalledWith(2, 2, expect.any(AbortSignal));
    expect(slotsCalled).toEqual([0, 2]);
  });

  it("Should not skip slots when option is disabled", async () => {
    const genesisTime = Math.floor(Date.now() / 1000) - config.SLOT_DURATION_MS / 2000;
    const clock = new Clock(config, logger, {genesisTime, skipSlots: false});

    const slotsCalled: number[] = [];
    const onSlot = vi.fn().mockImplementation(async (slot: number) => {
      slotsCalled.push(slot);
      // First task takes longer than a slot
      if (slot === 0) {
        await new Promise((resolve) => setTimeout(resolve, config.SLOT_DURATION_MS + 100));
      }
    });

    clock.runEverySlot(onSlot);
    clock.start(controller.signal);

    // Must run once immediately
    expect(onSlot).toHaveBeenCalledOnce();
    expect(slotsCalled).toEqual([0]);

    // Should trigger slot 1 even though slot 0 is still running
    await vi.advanceTimersByTimeAsync(config.SLOT_DURATION_MS);
    expect(onSlot).toHaveBeenCalledTimes(2);
    expect(slotsCalled).toEqual([0, 1]);

    // Should trigger slot 2
    await vi.advanceTimersByTimeAsync(config.SLOT_DURATION_MS);
    expect(onSlot).toHaveBeenCalledTimes(3);
    expect(slotsCalled).toEqual([0, 1, 2]);

    // All slots should be called without skipping
    expect(onSlot).toHaveBeenNthCalledWith(1, 0, expect.any(AbortSignal));
    expect(onSlot).toHaveBeenNthCalledWith(2, 1, expect.any(AbortSignal));
    expect(onSlot).toHaveBeenNthCalledWith(3, 2, expect.any(AbortSignal));
  });

  describe("getCurrentSlot", () => {
    const testConfig = {SLOT_DURATION_MS: 12 * 1000} as BeaconConfig;
    const genesisTime = Math.floor(new Date("2021-01-01").getTime() / 1000);

    // Tests can fail under certain time slots, overriding the system time
    // with a specific value allows us to run tests deterministically
    beforeEach(() => {
      vi.setSystemTime(genesisTime * 1000);
    });

    const testCase: {name: string; delta: number}[] = [
      {name: "should return next slot after 11.5s", delta: 11.5},
      {name: "should return next slot after 12s", delta: 12},
      {name: "should return next slot after 12.5s", delta: 12.5},
    ];

    it.each(testCase)("$name", async ({delta}) => {
      const currentSlot = getCurrentSlotAround(testConfig, genesisTime);
      vi.advanceTimersByTime(delta * 1000);
      expect(getCurrentSlotAround(testConfig, genesisTime)).toBe(currentSlot + 1);
    });
  });
});
