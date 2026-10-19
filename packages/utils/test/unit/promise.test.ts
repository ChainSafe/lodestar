/* Causing this error on usage of expect.any(Number)  */
import {afterEach, describe, expect, it, vi} from "vitest";
import {PromiseFulfilledResult, PromiseRejectedResult, defer, wrapPromise} from "../../src/promise.js";

describe("promise", () => {
  describe("wrapPromise", () => {
    afterEach(() => {
      vi.restoreAllMocks();
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
      const now = vi.spyOn(Date, "now").mockReturnValue(1000);
      const {promise, resolve} = defer<string>();
      const result = wrapPromise(promise);

      now.mockReturnValue(1100);
      resolve("Resolved Value");

      await expect(promise).resolves.toBe("Resolved Value");
      expect((result as PromiseFulfilledResult<string>).durationMs).toBe(100);
    });

    it("should have correct durationMs attribute for promise which is rejected", async () => {
      const now = vi.spyOn(Date, "now").mockReturnValue(1000);
      const {promise, reject} = defer<string>();
      const result = wrapPromise(promise);

      now.mockReturnValue(1100);
      reject("Rejected Error");

      await expect(promise).rejects.toThrow("Rejected Error");
      await expect(result.promise).rejects.toThrow("Rejected Error");
      expect((result as PromiseRejectedResult<string>).durationMs).toBe(100);
    });
  });
});
