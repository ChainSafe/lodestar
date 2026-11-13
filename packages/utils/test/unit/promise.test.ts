/* Causing this error on usage of expect.any(Number)  */
import {afterEach, describe, expect, it, vi} from "vitest";
import {PromiseFulfilledResult, PromiseRejectedResult, wrapPromise} from "../../src/promise.js";

describe("promise", () => {
  describe("wrapPromise", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("should have initial status to pending", async () => {
      const result = wrapPromise(Promise.resolve("my value"));
      expect(result.status).toBe("pending");
    });

    it("should resolve to value for a resolved promise", async () => {
      const promise = Promise.resolve("my value");
      const result = wrapPromise(promise);

      await expect(promise).resolves.toBe("my value");
      expect(result).toEqual({
        value: "my value",
        status: "fulfilled",
        promise,
        durationMs: expect.any(Number),
      });
    });

    it("should throw error for rejected promise", async () => {
      const promise = Promise.reject("test error");
      const result = wrapPromise(promise);

      await expect(promise).rejects.toThrow("test error");
      await expect(result.promise).rejects.toThrow("test error");
      expect(result).toEqual({
        reason: "test error",
        status: "rejected",
        promise,
        durationMs: expect.any(Number),
      });
    });

    it("should have correct durationMs attribute for promise which is resolved", async () => {
      vi.useFakeTimers({now: 1000});
      const promise = new Promise<string>((resolve) => setTimeout(() => resolve("Resolved Value"), 100));
      const result = wrapPromise(promise);

      await vi.advanceTimersByTimeAsync(100);

      await expect(promise).resolves.toBe("Resolved Value");
      expect((result as PromiseFulfilledResult<string>).durationMs).toBe(100);
    });

    it("should have correct durationMs attribute for promise which is rejected", async () => {
      vi.useFakeTimers({now: 1000});
      const promise = new Promise<string>((_, reject) => setTimeout(() => reject("Rejected Error"), 100));
      const result = wrapPromise(promise);
      // Attach before advancing, `result.promise` rethrows and would otherwise reject unhandled
      const rejection = expect(result.promise).rejects.toThrow("Rejected Error");

      await vi.advanceTimersByTimeAsync(100);

      await expect(promise).rejects.toThrow("Rejected Error");
      await rejection;
      expect((result as PromiseRejectedResult<string>).durationMs).toBe(100);
    });
  });
});
