import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {AbortController} from "@chainsafe/abort-controller";
import {withTimeout} from "../../src/timeout.js";
import {ErrorAborted, TimeoutError} from "../../src/errors.js";

chai.use(chaiAsPromised);

describe("withTimeout", function () {
  const data = "DATA";
  const shortTimeoutMs = 10;
  // Sleep for longer than the current test timeout.
  // If the abort signal doesn't work mocha will throw a timeout error
  const longTimeoutMs = 2 * this.timeout();

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

  it("Should resolve timeout", async function () {
    const res = await withTimeout(() => pause(shortTimeoutMs, data), longTimeoutMs);
    expect(res).to.equal(data);
  });

  it("Should resolve timeout with not triggered signal", async function () {
    const controller = new AbortController();

    const res = await withTimeout(() => pause(shortTimeoutMs, data), longTimeoutMs, controller.signal);
    expect(res).to.equal(data);
  });

  it("Should abort timeout with triggered signal", async function () {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), shortTimeoutMs);

    await expect(withTimeout(() => pause(longTimeoutMs, data), longTimeoutMs, controller.signal)).to.rejectedWith(
      ErrorAborted
    );
  });

  it("Should timeout with no signal", async function () {
    await expect(withTimeout(() => pause(longTimeoutMs, data), shortTimeoutMs)).to.rejectedWith(TimeoutError);
  });

  it("Should timeout with not triggered signal", async function () {
    const controller = new AbortController();

    await expect(withTimeout(() => pause(longTimeoutMs, data), shortTimeoutMs, controller.signal)).to.rejectedWith(
      TimeoutError
    );
  });

  it("Should abort timeout with already aborted signal", async function () {
    const controller = new AbortController();

    controller.abort();
    expect(controller.signal.aborted, "Signal should already be aborted").to.be.true;

    await expect(withTimeout(() => pause(shortTimeoutMs, data), shortTimeoutMs, controller.signal)).to.rejectedWith(
      ErrorAborted
    );
  });
});
