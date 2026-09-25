import {describe, expect, it, vi} from "vitest";
import {Histogram} from "@lodestar/utils";
import {EventLoopDelayByPhase} from "../../../src/metrics/eventLoopDelayByPhase.js";

describe("metrics / EventLoopDelayByPhase", () => {
  it("charges a blocked event loop to the phase its probe was due in", async () => {
    // 16 phase buckets of 1 s each, with the next boundary 30 ms away
    const slotMs = 16_000;
    const histogram = {observe: vi.fn()};
    const probe = new EventLoopDelayByPhase(
      Date.now() - 970,
      slotMs,
      histogram as unknown as Histogram<{phase_bps: string}>
    );
    try {
      // The probe due in 10 ms runs after the next boundary
      const blockedAt = performance.now();
      while (performance.now() - blockedAt < 80);
      await new Promise((resolve) => setTimeout(resolve, 30));
    } finally {
      probe.stop();
    }

    const late = histogram.observe.mock.calls.filter(([, seconds]) => seconds >= 0.05);
    expect(late).toEqual([[{phase_bps: "0000"}, expect.any(Number)]]);
    expect(histogram.observe).toHaveBeenCalledWith({phase_bps: "0625"}, expect.any(Number));
    const calls = histogram.observe.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(histogram.observe.mock.calls.length).toBe(calls);
  });
});
