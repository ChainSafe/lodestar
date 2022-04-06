import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {AbortController} from "@chainsafe/abort-controller";
import {sleep} from "../../src/sleep.js";
import {ErrorAborted} from "../../src/errors.js";

chai.use(chaiAsPromised);

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
    expect(controller.signal.aborted, "Signal should already be aborted").to.be.true;

    await expect(sleep(0, controller.signal)).to.rejectedWith(ErrorAborted);
  });
});
