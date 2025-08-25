import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {CHECK_DISCONNECTED_PEERS_INTERVAL_MS, SelfRateLimiter} from "../../../src/rate_limiter/selfRateLimiter.js";

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
    expect(selfRateLimiter.allows("peer1", "protocol1")).toBe(true);
    expect(selfRateLimiter.allows("peer1", "protocol1")).toBe(true);
  });

  it("blocks requests over the limit", () => {
    selfRateLimiter.allows("peer1", "protocol1");
    selfRateLimiter.allows("peer1", "protocol1");
    expect(selfRateLimiter.allows("peer1", "protocol1")).toBe(false);
    // but allows a different protocol
    expect(selfRateLimiter.allows("peer1", "protocol2")).toBe(true);
    // allows a different peer
    expect(selfRateLimiter.allows("peer2", "protocol1")).toBe(true);

    // allow after request completed
    selfRateLimiter.requestCompleted("peer1", "protocol1");
    expect(selfRateLimiter.allows("peer1", "protocol1")).toBe(true);
  });

  it("should remove disconnected peers after interval", () => {
    selfRateLimiter.allows("peer1", "protocol1");
    selfRateLimiter.allows("peer1", "protocol1");
    expect(selfRateLimiter.allows("peer1", "protocol1")).toBe(false);

    vi.advanceTimersByTime(CHECK_DISCONNECTED_PEERS_INTERVAL_MS + 1);
    expect(selfRateLimiter.allows("peer1", "protocol1")).toBe(true);
  });
});
