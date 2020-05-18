import {RateCounter} from "../../../../src/sync/stats/rate";
import {expect} from "chai";
import sinon from "sinon";

describe("rate counter", function () {

  it("should throw if period less than one", function () {
    expect(() => new RateCounter(0)).to.throw();
  });

  it("should start and stop cleanly", async function () {
    const rate = new RateCounter(10);
    await rate.start();
    await rate.stop();
  });

  it("should get rate", async function () {
    const timer = sinon.useFakeTimers();
    const rate = new RateCounter(10);
    await rate.start();
    rate.increment(2);
    timer.tick(2000);
    expect(rate.rate()).to.equal(1);
    timer.tick(8000);
    expect(rate.rate()).to.equal(0);
    rate.increment(1);
    timer.tick(2000);
    expect(rate.rate()).to.equal(0.5);
    await rate.stop();
  });

});
