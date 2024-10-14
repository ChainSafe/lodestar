import {describe, it, expect, afterEach} from "vitest";
import {withTimeout} from "../../src/timeout.js";
import {ErrorAborted, TimeoutError} from "../../src/errors.js";

describe("withTimeout", () => {
  const data = "DATA";
  const shortTimeoutMs = 10;
  const longTimeoutMs = 5000;

  const pendingTimeouts: NodeJS.Timeout[] = [];

  // Clear the timeouts of the mock async functions to not hang tests
  afterEach(() => {
    for (const pendingTimeout of pendingTimeouts) {
      clearTimeout(pendingTimeout);
    }
  });

  /**
   * Simulates an async task that may or may not resolve quickly
   * Simple pause for testing only. Clears the timeouts to not hang the tests
   */
  async function pause<T>(ms: number, returnValue: T): Promise<T> {
    await new Promise((r) => {
      pendingTimeouts.push(setTimeout(r, ms));
    });
    return returnValue;
  }

  it("Should resolve timeout", async () => {
    const res = await withTimeout(() => pause(shortTimeoutMs, data), longTimeoutMs);
    expect(res).toBe(data);
  });

  it("Should resolve timeout with not triggered signal", async () => {
    const controller = new AbortController();

    const res = await withTimeout(() => pause(shortTimeoutMs, data), longTimeoutMs, controller.signal);
    expect(res).toBe(data);
  });

  it("Should abort timeout with triggered signal", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), shortTimeoutMs);

    await expect(withTimeout(() => pause(longTimeoutMs, data), longTimeoutMs, controller.signal)).rejects.toThrow(
      ErrorAborted
    );
  });

  it("Should timeout with no signal", async () => {
    await expect(withTimeout(() => pause(longTimeoutMs, data), shortTimeoutMs)).rejects.toThrow(TimeoutError);
  });

  it("Should timeout with not triggered signal", async () => {
    const controller = new AbortController();

    await expect(withTimeout(() => pause(longTimeoutMs, data), shortTimeoutMs, controller.signal)).rejects.toThrow(
      TimeoutError
    );
  });

  it("Should abort timeout with already aborted signal", async () => {
    const controller = new AbortController();

    controller.abort();
    // "Signal should already be aborted"
    expect(controller.signal.aborted).toBe(true);

    await expect(withTimeout(() => pause(shortTimeoutMs, data), shortTimeoutMs, controller.signal)).rejects.toThrow(
      ErrorAborted
    );
  });
});
