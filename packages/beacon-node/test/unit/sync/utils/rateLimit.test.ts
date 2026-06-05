import {afterEach, describe, expect, it, vi} from "vitest";
import {RequestError, RequestErrorCode} from "@lodestar/reqresp";
import {RATE_LIMITED_PEER_BACKOFF_MS} from "../../../../src/sync/constants.js";
import {getRateLimitedUntilMs} from "../../../../src/sync/utils/rateLimit.js";

describe("sync / utils / rateLimit", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns rate-limit metadata when present", () => {
    const rateLimitedUntilMs = Date.now() + 1_000;
    const error = new RequestError({code: RequestErrorCode.REQUEST_SELF_RATE_LIMITED, rateLimitedUntilMs});

    expect(getRateLimitedUntilMs(error)).toBe(rateLimitedUntilMs);
  });

  it("falls back to the sync backoff when metadata is missing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const error = new RequestError({code: RequestErrorCode.REQUEST_SELF_RATE_LIMITED});

    expect(getRateLimitedUntilMs(error)).toBe(1_000 + RATE_LIMITED_PEER_BACKOFF_MS);
  });

  it("returns null for non-rate-limit errors", () => {
    const error = new RequestError({code: RequestErrorCode.REQUEST_TIMEOUT});

    expect(getRateLimitedUntilMs(error)).toBeNull();
    expect(getRateLimitedUntilMs(new Error("nope"))).toBeNull();
  });
});
