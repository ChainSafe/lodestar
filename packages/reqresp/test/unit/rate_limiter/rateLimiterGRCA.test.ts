import {expect} from "chai";
import sinon from "sinon";
import {RateLimiterGRCA} from "../../../src/rate_limiter/rateLimiterGRCA.js";

describe("rateLimiterGRCA", () => {
  let rateLimiter: RateLimiterGRCA<null>;
  const limit = 500;
  const limitTimeMs = 60 * 1000; // 1 min
  const sandbox = sinon.createSandbox();

  beforeEach(() => {
    sandbox.useFakeTimers();
    rateLimiter = RateLimiterGRCA.fromQuota({quotaTimeMs: limitTimeMs, quota: limit});
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("allows()", () => {
    it("should throw error if requested for a zero value", () => {
      expect(() => rateLimiter.allows(null, 0)).to.throw("Token value should always be positive. Given: 0");
    });

    it("should throw error if requested for a negative value", () => {
      expect(() => rateLimiter.allows(null, -1)).to.throw("Token value should always be positive. Given: -1");
    });

    it("should return valid number of requests within request window", () => {
      expect(rateLimiter.allows(null, 10)).to.be.true;
      expect(rateLimiter.allows(null, 50)).to.be.true;
    });

    it("should return valid number of requests within request window for maximum requests", () => {
      expect(rateLimiter.allows(null, limit)).to.be.true;
    });

    it("should return zero within request window for higher number of requests", () => {
      expect(rateLimiter.allows(null, limit + 1)).to.be.false;
    });

    it("should return zero once the tracker limit reached", () => {
      rateLimiter.allows(null, limit);
      expect(rateLimiter.allows(null, 10)).to.be.false;
    });

    it("should return over limit values before limit reached", () => {
      rateLimiter.allows(null, limit - 10);
      expect(rateLimiter.allows(null, 15)).to.be.false;
    });

    it("should reset the rate after the time limit", () => {
      rateLimiter.allows(null, limit);
      expect(rateLimiter.allows(null, 10)).to.be.false;
      sandbox.clock.tick(limitTimeMs);
      expect(rateLimiter.allows(null, 10)).to.be.true;
    });
  });

  // This is a private behavior but important to test to avoid memory leaks
  // describe("prune()", () => {
  //   it.skip("should remove old entries", () => {});
  // });
});
