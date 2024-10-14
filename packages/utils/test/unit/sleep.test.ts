import {describe, it, expect} from "vitest";
import {sleep} from "../../src/sleep.js";
import {ErrorAborted} from "../../src/errors.js";

describe("sleep", () => {
  it("Should resolve timeout", async () => {
    const controller = new AbortController();
    await sleep(0, controller.signal);
  });

  it("Should abort timeout with signal", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);

    const sleepTime = 5000;

    await expect(sleep(sleepTime, controller.signal)).rejects.toThrow(ErrorAborted);
  });

  it("Should abort timeout with already aborted signal", async () => {
    const controller = new AbortController();

    controller.abort();
    // "Signal should already be aborted"
    expect(controller.signal.aborted).toBe(true);

    await expect(sleep(0, controller.signal)).rejects.toThrow(ErrorAborted);
  });

  it("sleep 0 must tick the event loop", async () => {
    enum Step {
      beforeSleep = "beforeSleep",
      afterSleep = "afterSleep",
      setTimeout0 = "setTimeout0",
    }

    const steps: Step[] = [];

    setTimeout(() => {
      steps.push(Step.setTimeout0);
    }, 0);

    steps.push(Step.beforeSleep);
    await sleep(0);
    steps.push(Step.afterSleep);

    // Manual sleep to wait 2 ticks
    for (let i = 0; i < 2; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }

    expect(steps).toEqual([
      // Sync execution
      Step.beforeSleep,
      // Next tick, first registered callback
      Step.setTimeout0,
      // Next tick, second registered callback
      Step.afterSleep,
    ]);
  });
});
