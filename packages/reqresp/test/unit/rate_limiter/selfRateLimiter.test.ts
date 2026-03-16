import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {
  CHECK_DISCONNECTED_PEERS_INTERVAL_MS,
  DEFAULT_RATE_LIMIT_BACKOFF_MS,
  MAX_RATE_LIMIT_BACKOFF_MS,
  REQUEST_TIMEOUT_MS,
  SelfRateLimiter,
} from "../../../src/rate_limiter/selfRateLimiter.js";

describe("SelfRateLimiter", () => {
  let selfRateLimiter: SelfRateLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
    selfRateLimiter = new SelfRateLimiter();
    selfRateLimiter.start();
  });

  afterEach(() => {
    selfRateLimiter.stop();
    vi.useRealTimers();
  });

  it("allows requests under the limit", () => {
    expect(selfRateLimiter.allows("peer1", "protocol1", 1)).toBe(true);
    expect(selfRateLimiter.allows("peer1", "protocol1", 2)).toBe(true);
  });

  it("blocks requests over the limit", () => {
    selfRateLimiter.allows("peer1", "protocol1", 1);
    selfRateLimiter.allows("peer1", "protocol1", 2);
    expect(selfRateLimiter.allows("peer1", "protocol1", 3)).toBe(false);
    // but allows a different protocol
    expect(selfRateLimiter.allows("peer1", "protocol2", 4)).toBe(true);
    // allows a different peer
    expect(selfRateLimiter.allows("peer2", "protocol1", 5)).toBe(true);

    // allow after request completed
    selfRateLimiter.requestCompleted("peer1", "protocol1", 1);
    expect(selfRateLimiter.allows("peer1", "protocol1", 6)).toBe(true);
  });

  it("should timeout requests after REQUEST_TIMEOUT_MS", () => {
    selfRateLimiter.allows("peer1", "protocol1", 1);
    selfRateLimiter.allows("peer1", "protocol1", 2);
    expect(selfRateLimiter.allows("peer1", "protocol1", 3)).toBe(false);

    vi.advanceTimersByTime(REQUEST_TIMEOUT_MS);
    expect(selfRateLimiter.allows("peer1", "protocol1", 4)).toBe(true);
  });

  it("should remove disconnected peers after interval", () => {
    selfRateLimiter.allows("peer1", "protocol1", 1);
    selfRateLimiter.allows("peer1", "protocol1", 2);
    expect(selfRateLimiter.allows("peer1", "protocol1", 3)).toBe(false);

    vi.advanceTimersByTime(CHECK_DISCONNECTED_PEERS_INTERVAL_MS + 1);
    expect(selfRateLimiter.allows("peer1", "protocol1", 4)).toBe(true);
  });

  describe("rate limit backoff", () => {
    it("should block requests to a peer after onRateLimited", () => {
      expect(selfRateLimiter.allows("peer1", "protocol1", 1)).toBe(true);
      selfRateLimiter.requestCompleted("peer1", "protocol1", 1);

      selfRateLimiter.onRateLimited("peer1");

      // All protocols should be blocked for this peer
      expect(selfRateLimiter.allows("peer1", "protocol1", 2)).toBe(false);
      expect(selfRateLimiter.allows("peer1", "protocol2", 3)).toBe(false);

      // Other peers should not be affected
      expect(selfRateLimiter.allows("peer2", "protocol1", 4)).toBe(true);
    });

    it("should allow requests after backoff expires", () => {
      selfRateLimiter.onRateLimited("peer1");
      expect(selfRateLimiter.allows("peer1", "protocol1", 1)).toBe(false);

      vi.advanceTimersByTime(DEFAULT_RATE_LIMIT_BACKOFF_MS);
      expect(selfRateLimiter.allows("peer1", "protocol1", 2)).toBe(true);
    });

    it("should support custom backoff duration", () => {
      const customBackoffMs = 15_000;
      selfRateLimiter.onRateLimited("peer1", customBackoffMs);
      expect(selfRateLimiter.allows("peer1", "protocol1", 1)).toBe(false);

      vi.advanceTimersByTime(DEFAULT_RATE_LIMIT_BACKOFF_MS);
      // Still blocked because custom backoff is longer
      expect(selfRateLimiter.allows("peer1", "protocol1", 2)).toBe(false);

      vi.advanceTimersByTime(customBackoffMs - DEFAULT_RATE_LIMIT_BACKOFF_MS);
      expect(selfRateLimiter.allows("peer1", "protocol1", 3)).toBe(true);
    });

    it("should track rate limited peer count", () => {
      expect(selfRateLimiter.getRateLimitedPeerCount()).toBe(0);

      selfRateLimiter.onRateLimited("peer1");
      selfRateLimiter.onRateLimited("peer2");
      expect(selfRateLimiter.getRateLimitedPeerCount()).toBe(2);

      vi.advanceTimersByTime(DEFAULT_RATE_LIMIT_BACKOFF_MS);
      // Entries cleaned up on next allows() call or cleanup interval
      selfRateLimiter.allows("peer1", "protocol1", 1);
      expect(selfRateLimiter.getRateLimitedPeerCount()).toBe(1);
    });

    it("should cap backoff at MAX_RATE_LIMIT_BACKOFF_MS", () => {
      selfRateLimiter.onRateLimited("peer1", 300_000);
      expect(selfRateLimiter.allows("peer1", "protocol1", 1)).toBe(false);

      // Should unblock at MAX, not at the requested 300s
      vi.advanceTimersByTime(MAX_RATE_LIMIT_BACKOFF_MS);
      expect(selfRateLimiter.allows("peer1", "protocol1", 2)).toBe(true);
    });

    it("should keep backoff alive during blocked attempts", () => {
      selfRateLimiter.onRateLimited("peer1", MAX_RATE_LIMIT_BACKOFF_MS);

      // Attempt midway through backoff — should still be blocked
      vi.advanceTimersByTime(30_000);
      expect(selfRateLimiter.allows("peer1", "protocol1", 1)).toBe(false);

      // Backoff entry should still be tracked (allows() updates lastSeen
      // so checkDisconnectedPeers doesn't prematurely evict the entry)
      expect(selfRateLimiter.getRateLimitedPeerCount()).toBe(1);
    });

    it("should clean up expired backoff entries on disconnected peer check", () => {
      selfRateLimiter.onRateLimited("peer1");
      expect(selfRateLimiter.getRateLimitedPeerCount()).toBe(1);

      vi.advanceTimersByTime(CHECK_DISCONNECTED_PEERS_INTERVAL_MS + 1);
      expect(selfRateLimiter.getRateLimitedPeerCount()).toBe(0);
    });
  });
});
