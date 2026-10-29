import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {RateLimiterGRCA} from "../../../src/rate_limiter/rateLimiterGRCA.js";

describe("rateLimiterGRCA", () => {
  let rateLimiter: RateLimiterGRCA<null>;
  const limit = 500;
  const limitTimeMs = 60 * 1000; // 1 min

  beforeEach(() => {
    vi.useFakeTimers();
    rateLimiter = RateLimiterGRCA.fromQuota({quotaTimeMs: limitTimeMs, quota: limit});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("allows()", () => {
    it("should charge (not throw) a zero-token request, clamping it to 1", () => {
      expect(rateLimiter.allows(null, 0)).toBe(true);
      expect(rateLimiter.allows(null, -1)).toBe(true);
    });

    it("should count clamped zero-token requests against the quota until it is exhausted", () => {
      for (let i = 0; i < limit; i++) {
        expect(rateLimiter.allows(null, 0), `zero-token request ${i} should be charged and allowed`).toBe(true);
      }
      expect(rateLimiter.allows(null, 0)).toBe(false);
    });

    it("should return valid number of requests within request window", () => {
      expect(rateLimiter.allows(null, 10)).toBe(true);
      expect(rateLimiter.allows(null, 50)).toBe(true);
    });

    it("should return valid number of requests within request window for maximum requests", () => {
      expect(rateLimiter.allows(null, limit)).toBe(true);
    });

    it("should return zero within request window for higher number of requests", () => {
      expect(rateLimiter.allows(null, limit + 1)).toBe(false);
    });

    it("should return zero once the tracker limit reached", () => {
      rateLimiter.allows(null, limit);
      expect(rateLimiter.allows(null, 10)).toBe(false);
    });

    it("should return over limit values before limit reached", () => {
      rateLimiter.allows(null, limit - 10);
      expect(rateLimiter.allows(null, 15)).toBe(false);
    });

    it("should reset the rate after the time limit", () => {
      rateLimiter.allows(null, limit);
      expect(rateLimiter.allows(null, 10)).toBe(false);
      vi.advanceTimersByTime(limitTimeMs);
      expect(rateLimiter.allows(null, 10)).toBe(true);
    });
  });
});
