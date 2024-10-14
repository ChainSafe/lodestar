import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import {config} from "@lodestar/config/default";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconConfig} from "@lodestar/config";
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
    const genesisTime = Math.floor(Date.now() / 1000) - config.SECONDS_PER_SLOT / 2;
    const clock = new Clock(config, logger, {genesisTime});

    const onSlot = vi.fn().mockResolvedValue(undefined);
    clock.runEverySlot(onSlot);
    clock.start(controller.signal);

    // Must run once immediately
    expect(onSlot).toHaveBeenCalledOnce();
    expect(onSlot).toHaveBeenNthCalledWith(1, 0, expect.any(AbortSignal));

    await vi.advanceTimersByTimeAsync(config.SECONDS_PER_SLOT * 1000);
    expect(onSlot).toHaveBeenCalledTimes(2);
    expect(onSlot).toHaveBeenNthCalledWith(2, 1, expect.any(AbortSignal));

    await vi.advanceTimersByTimeAsync(config.SECONDS_PER_SLOT * 1000);
    expect(onSlot).toHaveBeenCalledTimes(3);
    expect(onSlot).toHaveBeenNthCalledWith(3, 2, expect.any(AbortSignal));
  });

  it("Should stop calling on slot after stop()", async () => {
    const genesisTime = Math.floor(Date.now() / 1000) - config.SECONDS_PER_SLOT / 2;
    const clock = new Clock(config, logger, {genesisTime});

    const onSlot = vi.fn().mockResolvedValue(undefined);
    clock.runEverySlot(onSlot);
    clock.start(controller.signal);

    await vi.advanceTimersByTimeAsync(config.SECONDS_PER_SLOT * 1000);
    expect(onSlot).toBeCalledTimes(2);
    expect(onSlot).toHaveBeenNthCalledWith(2, 1, expect.any(AbortSignal));

    // Stop clock
    controller.abort();
    await vi.advanceTimersByTimeAsync(config.SECONDS_PER_SLOT * 1000);
    expect(onSlot).toBeCalledTimes(2);
  });

  it("Should call on epoch", async () => {
    // Start halfway through an epoch, so advancing a slot does not cross to the next epoch
    const genesisTime = Math.floor(Date.now() / 1000) - (SLOTS_PER_EPOCH * config.SECONDS_PER_SLOT) / 2;

    const clock = new Clock(config, logger, {genesisTime});

    const onEpoch = vi.fn().mockResolvedValue(undefined);
    clock.runEveryEpoch(onEpoch);
    clock.start(controller.signal);

    // Must run once immediately
    expect(onEpoch).toHaveBeenCalledOnce();
    expect(onEpoch).toHaveBeenCalledWith(0, expect.any(AbortSignal));

    await vi.advanceTimersByTimeAsync(config.SECONDS_PER_SLOT * 1000);
    expect(onEpoch).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(SLOTS_PER_EPOCH * config.SECONDS_PER_SLOT * 1000);
    expect(onEpoch).toHaveBeenCalledTimes(2);
    expect(onEpoch).toHaveBeenNthCalledWith(2, 1, expect.any(AbortSignal));
  });

  describe("getCurrentSlot", () => {
    const testConfig = {SECONDS_PER_SLOT: 12} as BeaconConfig;
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
