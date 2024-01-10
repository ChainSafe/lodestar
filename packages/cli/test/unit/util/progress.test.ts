import {describe, it, expect, vi, beforeEach, afterEach} from "vitest";
import {showProgress} from "../../../src/util/progress.js";

describe("progress", () => {
  describe("showProgress", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.clearAllTimers();
    });

    it("should call progress with correct frequency", () => {
      const progress = vi.fn();
      const frequencyMs = 50;
      showProgress({total: 10, signal: new AbortController().signal, frequencyMs, progress});
      vi.advanceTimersByTime(frequencyMs * 4);

      expect(progress).toBeCalledTimes(4);
    });

    it("should call progress with correct values", () => {
      const progress = vi.fn();
      const frequencyMs = 50;
      const total = 8;
      const needle = showProgress({total, signal: new AbortController().signal, frequencyMs, progress});
      vi.advanceTimersByTime(frequencyMs);
      needle(1);
      vi.advanceTimersByTime(frequencyMs);
      needle(3);
      vi.advanceTimersByTime(frequencyMs);

      expect(progress).toHaveBeenCalledTimes(3);
      expect(progress).nthCalledWith(1, {total, current: 0, ratePerSec: 0, percentage: 0});
      expect(progress).nthCalledWith(2, {total, current: 2, ratePerSec: 40, percentage: 25});
      expect(progress).nthCalledWith(3, {total, current: 4, ratePerSec: 40, percentage: 50});
    });

    it("should call progress with correct values when reach total", () => {
      const progress = vi.fn();
      const frequencyMs = 50;
      const total = 8;
      const needle = showProgress({total, signal: new AbortController().signal, frequencyMs, progress});
      needle(1);
      vi.advanceTimersByTime(frequencyMs);
      needle(7);

      // Once by timer and second time because of reaching total
      expect(progress).toHaveBeenCalledTimes(2);
      // ratePerSec is 0 (actually Infinity) because we reached total without moving the clock time
      expect(progress).nthCalledWith(2, {total, current: total, ratePerSec: 0, percentage: 100});
    });

    it("should call progress with correct values directly reaches to total", () => {
      const progress = vi.fn();
      const frequencyMs = 50;
      const total = 8;
      const needle = showProgress({total, signal: new AbortController().signal, frequencyMs, progress});
      needle(7);

      expect(progress).toHaveBeenCalledTimes(1);
      expect(progress).nthCalledWith(1, {total, current: total, ratePerSec: 0, percentage: 100});
    });

    it("should not call progress when initiated with zero total", () => {
      const progress = vi.fn();
      const frequencyMs = 50;
      const total = 0;
      showProgress({total, signal: new AbortController().signal, frequencyMs, progress});

      expect(progress).not.toHaveBeenCalled();
    });

    it("should not call progress further when abort signal is called", () => {
      const progress = vi.fn();
      const frequencyMs = 50;
      const controller = new AbortController();
      showProgress({total: 10, signal: controller.signal, frequencyMs, progress});
      vi.advanceTimersByTime(frequencyMs * 2);
      controller.abort();
      vi.advanceTimersByTime(frequencyMs * 2);

      expect(progress).toBeCalledTimes(2);
    });

    it("should not call progress further when total is reached", () => {
      const progress = vi.fn();
      const frequencyMs = 50;
      const needle = showProgress({total: 10, signal: new AbortController().signal, frequencyMs, progress});
      vi.advanceTimersByTime(frequencyMs * 2);
      needle(50);
      vi.advanceTimersByTime(frequencyMs * 2);

      // 2 calls based on interval and 1 call based on reaching total
      expect(progress).toBeCalledTimes(2 + 1);
    });
  });
});
