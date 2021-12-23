import {expect} from "chai";
import sinon from "sinon";
import {RateTracker} from "../../../../src/network/reqresp/rateTracker";

describe("RateTracker", () => {
  let rateTracker: RateTracker;
  const sandbox = sinon.createSandbox();

  beforeEach(() => {
    rateTracker = new RateTracker({limit: 500, timeoutMs: 60 * 1000});
    sandbox.useFakeTimers();
  });

  afterEach(() => {
    sandbox.restore();
  });

  /**
   * A rate tracker with limit 500 and 1 minute track
   * - request 300 => ok
   * - request 300 => ok
   * - request 100 => NOT ok
   * - tick 1 minute to reclaim all quota (500)
   * - request 100 => ok
   * - request 400 => ok
   */
  it("should request objects up to limit", () => {
    expect(rateTracker.getRequestedObjectsWithinWindow()).to.be.equal(0);
    expect(rateTracker.requestObjects(300)).to.be.equal(300);
    expect(rateTracker.getRequestedObjectsWithinWindow()).to.be.equal(300);
    expect(rateTracker.requestObjects(300)).to.be.equal(300);
    expect(rateTracker.getRequestedObjectsWithinWindow()).to.be.equal(600);
    expect(rateTracker.requestObjects(100)).to.be.equal(0);
    expect(rateTracker.getRequestedObjectsWithinWindow()).to.be.equal(600);
    sandbox.clock.tick(60 * 1000);
    expect(rateTracker.requestObjects(100)).to.be.equal(100);
    expect(rateTracker.getRequestedObjectsWithinWindow()).to.be.equal(100);
    expect(rateTracker.requestObjects(400)).to.be.equal(400);
    expect(rateTracker.getRequestedObjectsWithinWindow()).to.be.equal(500);
  });

  it.skip("rateTracker memory usage", () => {
    const startMem = process.memoryUsage().heapUsed;
    // make it full
    for (let i = 0; i < 500; i++) {
      rateTracker.requestObjects(1);
      sandbox.clock.tick(500);
    }
    // 370k in average
    const memUsed = process.memoryUsage().heapUsed - startMem;
    expect(memUsed).to.be.lt(400000, "Memory usage per RateTracker should be than 400k");
  });
});
