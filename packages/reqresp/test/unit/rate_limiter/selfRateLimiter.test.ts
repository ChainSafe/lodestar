import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {
  CHECK_DISCONNECTED_PEERS_INTERVAL_MS,
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
});
