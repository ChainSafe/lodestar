import {describe, it, expect} from "vitest";
import {waitFor, createElapsedTimeTracker} from "../../src/waitFor.js";
import {ErrorAborted, TimeoutError} from "../../src/errors.js";
import {sleep} from "../../src/sleep.js";

describe("waitFor", () => {
  const interval = 10;
  const timeout = 20;

  it("Should resolve if condition is already true", async () => {
    await expect(waitFor(() => true, {interval, timeout})).resolves.toBeUndefined();
  });

  it("Should resolve if condition becomes true within timeout", async () => {
    let condition = false;
    setTimeout(() => {
      condition = true;
    }, interval);
    await waitFor(() => condition, {interval, timeout});
  });

  it("Should reject with TimeoutError if condition does not become true within timeout", async () => {
    await expect(waitFor(() => false, {interval, timeout})).rejects.toThrow(TimeoutError);
  });

  it("Should reject with ErrorAborted if aborted before condition becomes true", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), interval);
    await expect(waitFor(() => false, {interval, timeout, signal: controller.signal})).rejects.toThrow(ErrorAborted);
  });

  it("Should reject with ErrorAborted if signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(waitFor(() => true, {interval, timeout, signal: controller.signal})).rejects.toThrow(ErrorAborted);
  });
});

describe("waitForElapsedTime", () => {
  it("should true for the first time", () => {
    const callIfTimePassed = createElapsedTimeTracker({minElapsedTime: 1000});

    expect(callIfTimePassed()).toBe(true);
  });

  it("should return true after the minElapsedTime has passed", async () => {
    const callIfTimePassed = createElapsedTimeTracker({minElapsedTime: 100});
    callIfTimePassed();

    await sleep(150);

    expect(callIfTimePassed()).toBe(true);
  });

  it("should return false before the minElapsedTime has passed", async () => {
    const callIfTimePassed = createElapsedTimeTracker({minElapsedTime: 100});
    callIfTimePassed();

    await sleep(10);

    expect(callIfTimePassed()).toBe(false);
  });
});
