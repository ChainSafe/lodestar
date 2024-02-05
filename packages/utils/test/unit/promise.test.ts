/* Causing this error on usage of expect.any(Number)  */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {describe, it, expect} from "vitest";
import {wrapPromise, PromiseRejectedResult, PromiseFulfilledResult} from "../../src/promise.js";

describe("promise", () => {
  describe("wrapPromise", () => {
    const timeoutMs = 100;
    // TODO: Debug how promise is resolved quicker than the timeout
    const promiseDurationMin = timeoutMs - 1;
    // Add some margin for execution
    const promiseDurationMax = timeoutMs + 20;

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
      const promise = new Promise((resolve) => {
        setTimeout(() => {
          resolve("Resolved Value");
        }, timeoutMs);
      });
      const result = wrapPromise(promise);

      await expect(promise).resolves.toBe("Resolved Value");
      expect((result as PromiseFulfilledResult<string>).durationMs).toBeGreaterThanOrEqual(promiseDurationMin);
      expect((result as PromiseFulfilledResult<string>).durationMs).toBeLessThanOrEqual(promiseDurationMax);
    });

    it("should have correct durationMs attribute for promise which is rejected", async () => {
      const promise = new Promise((_, reject) => {
        setTimeout(() => {
          reject("Rejected Error");
        }, timeoutMs);
      });
      const result = wrapPromise(promise);

      await expect(promise).rejects.toThrow("Rejected Error");
      await expect(result.promise).rejects.toThrow("Rejected Error");
      expect((result as PromiseRejectedResult<string>).durationMs).toBeGreaterThanOrEqual(promiseDurationMin);
      expect((result as PromiseRejectedResult<string>).durationMs).toBeLessThanOrEqual(promiseDurationMax);
    });
  });
});
