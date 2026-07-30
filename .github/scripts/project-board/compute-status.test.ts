import assert from "node:assert/strict";
import {test} from "node:test";
import {computeStatus} from "./compute-status.ts";
import type {PrSnapshot, ReviewInfo} from "./types.ts";

function pr(overrides: Partial<PrSnapshot>): PrSnapshot {
  return {prState: "OPEN", isDraft: false, pendingUserRequests: [], reviews: [], ...overrides};
}

function review(overrides: Partial<ReviewInfo>): ReviewInfo {
  return {authorLogin: "alice", fromUser: true, state: "COMMENTED", submittedAt: "2026-01-02T00:00:00Z", ...overrides};
}

test("merged and closed PRs are not touched (built-in workflow owns Done)", () => {
  assert.equal(computeStatus(pr({prState: "MERGED"})), null);
  assert.equal(computeStatus(pr({prState: "CLOSED"})), null);
});

test("draft is In Progress even with pending requests", () => {
  const p = pr({isDraft: true, pendingUserRequests: [{login: "bob", requestedAt: "2026-01-01T00:00:00Z"}]});
  assert.equal(computeStatus(p), "In Progress");
});

test("open non-draft with no signals is In Progress", () => {
  assert.equal(computeStatus(pr({})), "In Progress");
});

test("pending user request with no reviews is Review Requested", () => {
  const p = pr({pendingUserRequests: [{login: "bob", requestedAt: "2026-01-01T00:00:00Z"}]});
  assert.equal(computeStatus(p), "Review Requested");
});

test("comment review newer than request is Awaiting Author (even with request pending)", () => {
  const p = pr({
    pendingUserRequests: [{login: "bob", requestedAt: "2026-01-01T00:00:00Z"}],
    reviews: [review({submittedAt: "2026-01-02T00:00:00Z"})],
  });
  assert.equal(computeStatus(p), "Awaiting Author");
});

test("drive-by comment review with no request pending is Awaiting Author", () => {
  assert.equal(computeStatus(pr({reviews: [review({})]})), "Awaiting Author");
});

test("changes_requested behaves like commented", () => {
  const p = pr({
    pendingUserRequests: [{login: "bob", requestedAt: "2026-01-01T00:00:00Z"}],
    reviews: [review({state: "CHANGES_REQUESTED", submittedAt: "2026-01-02T00:00:00Z"})],
  });
  assert.equal(computeStatus(p), "Awaiting Author");
});

test("re-request newer than feedback flips back to Review Requested", () => {
  const p = pr({
    pendingUserRequests: [{login: "alice", requestedAt: "2026-01-03T00:00:00Z"}],
    reviews: [review({submittedAt: "2026-01-02T00:00:00Z"})],
  });
  assert.equal(computeStatus(p), "Review Requested");
});

test("timestamp tie between request and feedback: request wins", () => {
  const p = pr({
    pendingUserRequests: [{login: "alice", requestedAt: "2026-01-02T00:00:00Z"}],
    reviews: [review({submittedAt: "2026-01-02T00:00:00Z"})],
  });
  assert.equal(computeStatus(p), "Review Requested");
});

test("bot reviews are invisible", () => {
  const p = pr({
    pendingUserRequests: [{login: "bob", requestedAt: "2026-01-01T00:00:00Z"}],
    reviews: [review({authorLogin: "codex[bot]", fromUser: false, submittedAt: "2026-01-05T00:00:00Z"})],
  });
  assert.equal(computeStatus(p), "Review Requested");
});

test("approval with another request still pending stays Review Requested", () => {
  const p = pr({
    pendingUserRequests: [{login: "bob", requestedAt: "2026-01-01T00:00:00Z"}],
    reviews: [review({state: "APPROVED", submittedAt: "2026-01-02T00:00:00Z"})],
  });
  assert.equal(computeStatus(p), "Review Requested");
});

test("approval with no pending requests is Awaiting Author (merge me)", () => {
  const p = pr({reviews: [review({state: "APPROVED"})]});
  assert.equal(computeStatus(p), "Awaiting Author");
});

test("dismissed feedback does not count", () => {
  const p = pr({reviews: [review({state: "DISMISSED"})]});
  assert.equal(computeStatus(p), "In Progress");
});

test("pending (unsubmitted) reviews do not count", () => {
  const p = pr({reviews: [review({state: "PENDING"})]});
  assert.equal(computeStatus(p), "In Progress");
});

test("request removed scenario: lingering feedback with no pending requests is Awaiting Author", () => {
  const p = pr({reviews: [review({submittedAt: "2026-01-02T00:00:00Z"})]});
  assert.equal(computeStatus(p), "Awaiting Author");
});
