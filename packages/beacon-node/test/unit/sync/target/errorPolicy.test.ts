import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {RequestError, RequestErrorCode} from "@lodestar/reqresp";
import {BlockErrorCode} from "../../../../src/chain/errors/blockError.js";
import {ExecutionPayloadEnvelopeErrorCode} from "../../../../src/chain/errors/executionPayloadEnvelope.js";
import {
  classifyBlockImportError,
  classifyEnvelopeError,
  classifyRequestError,
  parkIfRateLimited,
} from "../../../../src/sync/target/errorPolicy.js";

// The switches are compile-time exhaustive (`satisfies never`); these sweeps are the
// runtime net for the same property, plus pins on the load-bearing rows so a
// reclassification is a deliberate, reviewed diff.

describe("sync / target / errorPolicy", () => {
  describe("classifyBlockImportError", () => {
    it("classifies every BlockErrorCode without throwing", () => {
      for (const code of Object.values(BlockErrorCode)) {
        expect(classifyBlockImportError(code)).toBeDefined();
      }
    });

    it("pins the load-bearing rows", () => {
      // Consensus-invalid → terminal invalid, exact-block attribution [A3].
      expect(classifyBlockImportError(BlockErrorCode.INVALID_STATE_ROOT)).toEqual({
        action: "invalid",
        scope: "block",
        score: true,
      });
      expect(classifyBlockImportError(BlockErrorCode.INVALID_SIGNATURE)).toEqual({
        action: "invalid",
        scope: "block",
        score: true,
      });
      // Lineage faults → chain scope (claimed-root advocate scoring [A2]).
      expect(classifyBlockImportError(BlockErrorCode.NOT_FINALIZED_DESCENDANT)).toEqual({
        action: "invalid",
        scope: "chain",
        score: true,
      });
      expect(classifyBlockImportError(BlockErrorCode.PARENT_EXECUTION_INVALID)).toEqual({
        action: "invalid",
        scope: "chain",
        score: true,
      });
      // Blacklist is local policy — invalid but nobody is scored.
      expect(classifyBlockImportError(BlockErrorCode.BLACKLISTED_BLOCK)).toEqual({
        action: "invalid",
        scope: "block",
        score: false,
      });
      // Never-score transients.
      expect(classifyBlockImportError(BlockErrorCode.EXECUTION_ENGINE_ERROR)).toEqual({
        action: "park",
        reason: "elOffline",
      });
      expect(classifyBlockImportError(BlockErrorCode.DATA_UNAVAILABLE)).toEqual({
        action: "park",
        reason: "awaitingData",
      });
      expect(classifyBlockImportError(BlockErrorCode.PARENT_PAYLOAD_UNKNOWN)).toEqual({
        action: "park",
        reason: "awaitingParentPayload",
      });
      // Fork choice moved beneath the walk — rewalk, don't fail.
      expect(classifyBlockImportError(BlockErrorCode.PARENT_UNKNOWN)).toEqual({action: "reanchor"});
      expect(classifyBlockImportError(BlockErrorCode.WOULD_REVERT_FINALIZED_SLOT)).toEqual({action: "reanchor"});
      expect(classifyBlockImportError(BlockErrorCode.ALREADY_KNOWN)).toEqual({action: "benign"});
    });

    it("never scores on internal/unreachable classifications", () => {
      for (const code of Object.values(BlockErrorCode)) {
        const res = classifyBlockImportError(code);
        if (res.action === "internal" || res.action === "park" || res.action === "reanchor") {
          // No scoring field exists on these shapes — the type system enforces it; this
          // documents the property the shapes encode.
          expect("score" in res).toBe(false);
        }
      }
    });
  });

  describe("classifyEnvelopeError", () => {
    it("classifies every ExecutionPayloadEnvelopeErrorCode without throwing", () => {
      for (const code of Object.values(ExecutionPayloadEnvelopeErrorCode)) {
        expect(classifyEnvelopeError(code)).toBeDefined();
      }
    });

    it("pins the load-bearing rows", () => {
      // Block-state verdicts are provably bad (unlike admission's head-state DEFER).
      expect(classifyEnvelopeError(ExecutionPayloadEnvelopeErrorCode.INVALID_SIGNATURE)).toEqual({
        action: "rejected",
      });
      expect(classifyEnvelopeError(ExecutionPayloadEnvelopeErrorCode.BLOCK_HASH_MISMATCH)).toEqual({
        action: "rejected",
      });
      // Block not yet importable — park the fill, wake on block arrival.
      expect(classifyEnvelopeError(ExecutionPayloadEnvelopeErrorCode.BLOCK_ROOT_UNKNOWN)).toEqual({
        action: "park",
        reason: "awaitingBlock",
      });
      expect(classifyEnvelopeError(ExecutionPayloadEnvelopeErrorCode.ENVELOPE_ALREADY_KNOWN)).toEqual({
        action: "benign",
      });
    });
  });

  describe("classifyRequestError", () => {
    it("classifies every RequestErrorCode without throwing", () => {
      for (const code of Object.values(RequestErrorCode)) {
        expect(classifyRequestError(code)).toBeDefined();
      }
    });

    it("never produces a scoring action (transport faults are on the never-report list)", () => {
      for (const code of Object.values(RequestErrorCode)) {
        expect(["rotate", "parkPeer", "selfThrottle"]).toContain(classifyRequestError(code).action);
      }
    });

    it("pins the rate-limit rows", () => {
      expect(classifyRequestError(RequestErrorCode.REQUEST_RATE_LIMITED)).toEqual({action: "parkPeer"});
      expect(classifyRequestError(RequestErrorCode.RESP_RATE_LIMITED)).toEqual({action: "parkPeer"});
      expect(classifyRequestError(RequestErrorCode.REQUEST_SELF_RATE_LIMITED)).toEqual({action: "selfThrottle"});
      expect(classifyRequestError(RequestErrorCode.RESOURCE_UNAVAILABLE)).toEqual({action: "rotate"});
    });
  });

  describe("parkIfRateLimited", () => {
    const NOW = 1_000_000;
    beforeEach(() => vi.useFakeTimers({now: NOW}));
    afterEach(() => vi.useRealTimers());

    function park(e: RequestError): {parked: boolean; forMs: number | undefined} {
      const calls: (number | undefined)[] = [];
      const parked = parkIfRateLimited({parkPeer: (_peer, forMs) => calls.push(forMs)}, "peer1", e);
      expect(calls.length).toBe(parked ? 1 : 0);
      return {parked, forMs: calls[0]};
    }

    it("parks until the carried deadline (dominates the classification)", () => {
      // RESP_RATE_LIMITED: the remote's deadline.
      expect(park(new RequestError({code: RequestErrorCode.RESP_RATE_LIMITED, rateLimitedUntilMs: NOW + 7_000}))) //
        .toEqual({parked: true, forMs: 7_000});
      // REQUEST_SELF_RATE_LIMITED with a deadline: our limiter is backing off this
      // peer — park until then even though the static classification is selfThrottle.
      expect(
        park(new RequestError({code: RequestErrorCode.REQUEST_SELF_RATE_LIMITED, rateLimitedUntilMs: NOW + 3_000}))
      ).toEqual({parked: true, forMs: 3_000});
      // A stale deadline never parks into the past.
      expect(park(new RequestError({code: RequestErrorCode.RESP_RATE_LIMITED, rateLimitedUntilMs: NOW - 1}))) //
        .toEqual({parked: true, forMs: 0});
    });

    it("falls back to the default park duration without a deadline", () => {
      expect(park(new RequestError({code: RequestErrorCode.REQUEST_RATE_LIMITED}))).toEqual({
        parked: true,
        forMs: undefined,
      });
    });

    it("does not park on self-throttle without a deadline or on non-rate-limit errors", () => {
      expect(park(new RequestError({code: RequestErrorCode.REQUEST_SELF_RATE_LIMITED})).parked).toBe(false);
      expect(park(new RequestError({code: RequestErrorCode.RESP_TIMEOUT})).parked).toBe(false);
    });
  });
});
