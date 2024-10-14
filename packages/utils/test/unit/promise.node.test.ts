import {describe, it, expect, vi, beforeEach, afterEach} from "vitest";
import {callFnWhenAwait} from "../../src/promise.js";

// TODO: Need to debug why vi.useFakeTimers() is not working for the browsers
describe("callFnWhenAwait util", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it("should call function while awaing for promise", async () => {
    const p = new Promise<string>((resolve) => setTimeout(() => resolve("done"), 5 * 1000));
    const stub = vi.fn();
    const result = await Promise.all([callFnWhenAwait(p, stub, 2 * 1000), vi.advanceTimersByTimeAsync(5000)]);
    expect(result[0]).toBe("done");
    expect(stub).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(stub).toHaveBeenCalledTimes(2);
  });

  it("should throw error", async () => {
    const stub = vi.fn();
    const p = new Promise<string>((_, reject) => setTimeout(() => reject(new Error("done")), 5 * 1000));
    try {
      await Promise.all([callFnWhenAwait(p, stub, 2 * 1000), vi.advanceTimersByTimeAsync(5000)]);
      expect.fail("should throw error here");
    } catch (e) {
      expect((e as Error).message).toBe("done");
      expect(stub).toHaveBeenCalledTimes(2);
    }
  });
});
