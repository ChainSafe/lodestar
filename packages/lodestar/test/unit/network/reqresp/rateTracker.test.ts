import {expect} from "chai";
import sinon from "sinon";
import {RateTracker} from "../../../../src/network/reqresp/rateTracker";

describe("RateTracker", () => {
  let rateTracker: RateTracker;
  const sandbox = sinon.createSandbox();

  beforeEach(() => {
    rateTracker = new RateTracker(500, 60 * 1000);
    sandbox.useFakeTimers();
  });

  afterEach(() => {
    sandbox.restore();
  });

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
});
