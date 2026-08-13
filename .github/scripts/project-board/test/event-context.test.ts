import assert from "node:assert/strict";
import {test} from "vitest";
import {
  buildEventContext,
  MISSING_TOKEN_ERROR_CODE,
  missingTokenSkipReason,
  ProjectBoardConfigurationError,
} from "../src/event-context.ts";

function pullRequestPayload(options: {head: string; base?: string; fork: boolean; author?: string}): unknown {
  const base = options.base ?? "ChainSafe/lodestar";
  return {
    repository: {full_name: base},
    pull_request: {
      number: 9732,
      user: {login: options.author ?? "contributor"},
      head: {repo: {full_name: options.head, fork: options.fork}},
      base: {repo: {full_name: base}},
    },
  };
}

test("missing token is tolerated for a confirmed fork pull_request_review event", () => {
  const context = buildEventContext(
    "pull_request_review",
    "reviewer",
    "ChainSafe/lodestar",
    pullRequestPayload({head: "contributor/lodestar", fork: true}),
  );

  assert.equal(missingTokenSkipReason(context), "fork_pull_request_review");
  assert.deepEqual(context.pullRequest, {owner: "ChainSafe", repo: "lodestar", number: 9732});
});

test("missing token fails for a fork pull_request_target event", () => {
  const context = buildEventContext(
    "pull_request_target",
    "contributor",
    "ChainSafe/lodestar",
    pullRequestPayload({head: "contributor/lodestar", fork: true}),
  );

  assert.equal(missingTokenSkipReason(context), null);
});

test("missing token fails for same-repository reviews", () => {
  const context = buildEventContext(
    "pull_request_review",
    "reviewer",
    "ChainSafe/lodestar",
    pullRequestPayload({head: "ChainSafe/lodestar", fork: false}),
  );

  assert.equal(missingTokenSkipReason(context), null);
});

test("missing token is tolerated for confirmed Dependabot events", () => {
  const context = buildEventContext(
    "pull_request_target",
    "dependabot[bot]",
    "ChainSafe/lodestar",
    pullRequestPayload({head: "ChainSafe/lodestar", fork: false, author: "dependabot[bot]"}),
  );

  assert.equal(missingTokenSkipReason(context), "dependabot_event");
});

test("Dependabot PR author alone does not hide a missing token", () => {
  const context = buildEventContext(
    "pull_request_target",
    "maintainer",
    "ChainSafe/lodestar",
    pullRequestPayload({head: "ChainSafe/lodestar", fork: false, author: "dependabot[bot]"}),
  );

  assert.equal(missingTokenSkipReason(context), null);
});

test("missing token configuration errors carry a stable code and context", () => {
  const context = buildEventContext("schedule", "github-actions[bot]", "ChainSafe/lodestar", null);
  const error = new ProjectBoardConfigurationError(context);

  assert.equal(error.code, MISSING_TOKEN_ERROR_CODE);
  assert.deepEqual(error.metadata, {eventName: "schedule", repository: "ChainSafe/lodestar"});
  assert.match(error.message, /PROJECT_BOARD_CONFIG_TOKEN_MISSING/);
  assert.match(error.message, /"eventName":"schedule"/);
});
