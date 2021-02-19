import {RateCounter} from "../../../../src/sync/stats/rate";
import {expect} from "chai";
import sinon from "sinon";

describe("rate counter", function () {
  const sandbox = sinon.createSandbox();
  beforeEach(() => {
    sandbox.useFakeTimers();
  });
  afterEach(() => {
    sandbox.restore();
  });
  it("should throw if period less than one", function () {
    expect(() => new RateCounter(0)).to.throw();
  });

  it("should start and stop cleanly", function () {
    const rate = new RateCounter(10);
    rate.start();
    rate.stop();
  });

  it("should get rate", function () {
    const rate = new RateCounter(10);
    rate.start();
    rate.increment(2);
    sandbox.clock.tick(2000);
    expect(rate.rate()).to.equal(1);
    sandbox.clock.tick(8000);
    expect(rate.rate()).to.equal(0);
    rate.increment(1);
    sandbox.clock.tick(2000);
    expect(rate.rate()).to.equal(0.5);
    rate.stop();
  });
});
