import {expect} from "chai";
import sinon from "sinon";
import {RateTracker} from "../../../../src/network/reqresp/rateTracker.js";

describe("RateTracker", () => {
  let rateTracker: RateTracker;
  const limit = 500;
  const limitTimeMs = 60 * 1000; // 1 min
  const sandbox = sinon.createSandbox();

  beforeEach(() => {
    rateTracker = new RateTracker({limit, limitTimeMs: limitTimeMs});
    sandbox.useFakeTimers();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("getRequestedObjectsWithinWindow()", () => {
    it("should return default value '0' after initialization", () => {
      expect(rateTracker.getRequestedObjectsWithinWindow()).to.be.equal(0);
    });

    it("should return incremented values after each request", () => {
      rateTracker.requestObjects(2);
      expect(rateTracker.getRequestedObjectsWithinWindow()).to.be.equal(2);
      rateTracker.requestObjects(2);
      expect(rateTracker.getRequestedObjectsWithinWindow()).to.be.equal(4);
    });
  });

  describe("requestObjects()", () => {
    it("should throw error if requested for a zero value", () => {
      expect(() => rateTracker.requestObjects(0)).to.throw("Invalid objectCount 0");
    });

    it("should throw error if requested for a negative value", () => {
      expect(() => rateTracker.requestObjects(-1)).to.throw("Invalid objectCount -1");
    });

    it("should return valid number of requests within request window", () => {
      expect(rateTracker.requestObjects(10)).to.be.equal(10);
      expect(rateTracker.requestObjects(50)).to.be.equal(50);
    });

    it("should return valid number of requests within request window for maximum requests", () => {
      expect(rateTracker.requestObjects(limit)).to.be.equal(limit);
    });

    it("should return zero once the tracker limit reached", () => {
      rateTracker.requestObjects(limit);
      expect(rateTracker.requestObjects(10)).to.be.equal(0);
    });

    it("should return over limit values before limit reached", () => {
      rateTracker.requestObjects(limit - 10);
      expect(rateTracker.requestObjects(15)).to.be.equal(15);
    });

    it("should reset the rate after the time limit", () => {
      rateTracker.requestObjects(limit);
      expect(rateTracker.requestObjects(10)).to.be.equal(0);
      expect(rateTracker.getRequestedObjectsWithinWindow()).to.be.equal(limit);
      sandbox.clock.tick(limitTimeMs);
      expect(rateTracker.requestObjects(10)).to.be.equal(10);
      expect(rateTracker.getRequestedObjectsWithinWindow()).to.be.equal(10);
    });
  });

  // This is a private behavior but important to test to avoid memory leaks
  describe("prune()", () => {
    it("should remove old entries", () => {
      rateTracker.requestObjects(10);
      sandbox.clock.tick(1000);
      rateTracker.requestObjects(10);
      expect(rateTracker["secondsMap"].size).to.be.equal(2);

      sandbox.clock.tick(limitTimeMs);
      rateTracker.requestObjects(10);
      expect(rateTracker["secondsMap"].size).to.be.equal(1);
    });
  });
});
