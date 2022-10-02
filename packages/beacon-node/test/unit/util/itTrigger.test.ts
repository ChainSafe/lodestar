import {expect} from "chai";
import all from "it-all";
import {ItTrigger} from "../../../src/util/itTrigger.js";

describe("util / itTrigger", () => {
  it("Should not buffer values and return immediately", async () => {
    const itTrigger = new ItTrigger();

    itTrigger.trigger();
    itTrigger.trigger();
    itTrigger.end();

    const res = await all(itTrigger);
    expect(res).to.have.length(0, "itTrigger should not yield any time");
  });

  it("When triggered multiple times syncronously should yield only twice", async () => {
    const itTrigger = new ItTrigger();

    setTimeout(() => {
      itTrigger.trigger();
      itTrigger.trigger();
      itTrigger.trigger();
      itTrigger.trigger();
      setTimeout(() => {
        itTrigger.end();
      }, 5);
    }, 5);

    const res = await all(itTrigger);
    expect(res).to.have.length(2, "itTrigger should yield exactly two times");
  });

  it("Should reject when calling end(Error)", async () => {
    const itTrigger = new ItTrigger();
    const testError = new Error("TEST_ERROR");

    setTimeout(() => {
      itTrigger.trigger();
      itTrigger.trigger();
      setTimeout(() => {
        itTrigger.end(testError);
      }, 5);
    }, 5);

    await expect(all(itTrigger)).to.be.rejectedWith(testError);
  });

  it("ItTrigger as a single thread processor", async () => {
    const processor = new ItTrigger();

    for (let i = 0; i <= 4; i++) {
      setTimeout(() => {
        processor.trigger();
      }, i * 5);
    }

    let counter = 0;
    for await (const _ of processor) {
      if (counter++ >= 3) {
        break;
      }
    }
  });
});
