import "../setup.js";
import {expect} from "chai";
import {sleep} from "../../src/sleep.js";
import {ErrorAborted} from "../../src/errors.js";

describe("sleep", function () {
  it("Should resolve timeout", async function () {
    const controller = new AbortController();
    await sleep(0, controller.signal);
  });

  it("Should abort timeout with signal", async function () {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);

    // Sleep for longer than the current test timeout.
    // If the abort signal doesn't work mocha will throw a timeout error
    const sleepTime = 2 * this.timeout();

    await expect(sleep(sleepTime, controller.signal)).to.rejectedWith(ErrorAborted);
  });

  it("Should abort timeout with already aborted signal", async function () {
    const controller = new AbortController();

    controller.abort();
    expect(controller.signal.aborted, "Signal should already be aborted").to.equal(true);

    await expect(sleep(0, controller.signal)).to.rejectedWith(ErrorAborted);
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

    expect(steps).to.deep.equal(
      [
        // Sync execution
        Step.beforeSleep,
        // Next tick, first registered callback
        Step.setTimeout0,
        // Next tick, second registered callback
        Step.afterSleep,
      ],
      "Wrong steps"
    );
  });
});
