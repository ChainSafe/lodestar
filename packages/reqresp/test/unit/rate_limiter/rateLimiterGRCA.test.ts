import {expect} from "chai";
import sinon from "sinon";
import {RateLimiterGRCA} from "../../../src/rate_limiter/rateLimiterGRCA.js";
type Seconds = number;

describe("rateLimiterGRCA", () => {
  describe("time-bound cases", () => {
    const replenishAllEvery = 2000;
    const maxTokens = 4;
    const key = 10;

    const testCases: {
      title: string;
      steps: {sec: Seconds; tokens: number; allows: boolean}[];
    }[] = [
      {
        //        x
        //  used  x
        // tokens x           x
        //        x  x  x     x
        //        +--+--+--+--+----> seconds
        //        |  |  |  |  |
        //        0     1     2
        title: "burst of tokens",
        steps: [
          {sec: 0.0, tokens: 4, allows: true},
          {sec: 0.1, tokens: 1, allows: false},
          {sec: 0.5, tokens: 1, allows: true},
          {sec: 1.0, tokens: 1, allows: true},
          {sec: 1.4, tokens: 1, allows: false},
          {sec: 2.0, tokens: 2, allows: true},
        ],
      },
      {
        // if we limit to 4T per 2s, check that 4 requests worth 1 token can be sent before the
        // first half second, when one token will be available again. Check also that before
        // regaining a token, another request is rejected
        title: "Fill bucket with single requests",
        steps: [
          {sec: 0.0, tokens: 1, allows: true},
          {sec: 0.1, tokens: 1, allows: true},
          {sec: 0.2, tokens: 1, allows: true},
          {sec: 0.3, tokens: 1, allows: true},
          {sec: 0.4, tokens: 1, allows: false},
        ],
      },
    ];

    for (const {title, steps} of testCases) {
      it(title, () => {
        const limiter = RateLimiterGRCA.fromQuota<number>({quotaTime: replenishAllEvery, quota: maxTokens});
        for (const [i, {sec, tokens, allows}] of steps.entries()) {
          expect(limiter.allows(key, tokens, sec * 1000)).equals(allows, `step ${i}`);
        }
      });
    }
  });

  describe("fake-time cases", () => {
    let rateLimiter: RateLimiterGRCA<null>;
    const limit = 500;
    const limitTimeMs = 60 * 1000; // 1 min
    const sandbox = sinon.createSandbox();

    beforeEach(() => {
      sandbox.useFakeTimers();
      rateLimiter = RateLimiterGRCA.fromQuota({quotaTime: limitTimeMs, quota: limit});
    });

    afterEach(() => {
      sandbox.restore();
    });

    describe("remainingTokens", () => {
      it("should return maximum tokens for current time window", () => {
        expect(rateLimiter.currentBucketRemainingTokens(null)).to.equal(limit);
      });

      it("should return valid remaining tokens for current time window", () => {
        rateLimiter.allows(null, 100);
        expect(rateLimiter.currentBucketRemainingTokens(null)).to.equal(limit - 100);
      });

      it("should return zero if all tokens are already consumed for current time window", () => {
        rateLimiter.allows(null, limit);
        expect(rateLimiter.currentBucketRemainingTokens(null)).to.equal(0);
      });

      it("should return valid remaining tokens when current time window passes", () => {
        rateLimiter.allows(null, limit);
        expect(rateLimiter.currentBucketRemainingTokens(null)).to.equal(0);
        sandbox.clock.tick(limitTimeMs / 2);
        expect(rateLimiter.currentBucketRemainingTokens(null)).to.equal(0);
        sandbox.clock.tick(limitTimeMs / 2);
        rateLimiter.allows(null, limit / 2);
        expect(rateLimiter.currentBucketRemainingTokens(null)).to.equal(limit / 2);
      });
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
});
