import assert from "node:assert/strict";
import {test} from "node:test";
import {buildSnapshot, pickProjectItem, type PrNode} from "../src/snapshot.ts";

function prNode(overrides: Partial<PrNode>): PrNode {
  return {
    id: "PR_test",
    state: "OPEN",
    isDraft: false,
    reviewRequests: {nodes: []},
    reviews: {nodes: []},
    timelineItems: {nodes: []},
    projectItems: {nodes: []},
    ...overrides,
  };
}

test("team review requests are excluded; user requests get timeline timestamps", () => {
  const node = prNode({
    reviewRequests: {
      nodes: [
        {requestedReviewer: {__typename: "Team", login: undefined}},
        {requestedReviewer: {__typename: "User", login: "alice"}},
      ],
    },
    timelineItems: {
      nodes: [
        {createdAt: "2026-01-01T00:00:00Z", requestedReviewer: {__typename: "User", login: "alice"}},
        {createdAt: "2026-01-03T00:00:00Z", requestedReviewer: {__typename: "User", login: "alice"}},
        {createdAt: "2026-01-04T00:00:00Z", requestedReviewer: {__typename: "Team", login: undefined}},
      ],
    },
  });
  const snap = buildSnapshot(node);
  assert.deepEqual(snap.pendingUserRequests, [{login: "alice", requestedAt: "2026-01-03T00:00:00Z"}]);
});

test("pending request with no timeline event falls back to epoch", () => {
  const node = prNode({
    reviewRequests: {nodes: [{requestedReviewer: {__typename: "User", login: "alice"}}]},
  });
  const snap = buildSnapshot(node);
  assert.deepEqual(snap.pendingUserRequests, [{login: "alice", requestedAt: "1970-01-01T00:00:00Z"}]);
});

test("bot and deleted review authors are marked fromUser=false", () => {
  const node = prNode({
    reviews: {
      nodes: [
        {state: "COMMENTED", submittedAt: "2026-01-01T00:00:00Z", author: {__typename: "Bot", login: "codex"}},
        {state: "COMMENTED", submittedAt: "2026-01-02T00:00:00Z", author: null},
        {state: "APPROVED", submittedAt: "2026-01-03T00:00:00Z", author: {__typename: "User", login: "bob"}},
      ],
    },
  });
  const snap = buildSnapshot(node);
  assert.deepEqual(snap.reviews.map((r) => r.fromUser), [false, false, true]);
});

test("reviews without submittedAt are dropped", () => {
  const node = prNode({
    reviews: {nodes: [{state: "PENDING", submittedAt: null, author: {__typename: "User", login: "bob"}}]},
  });
  assert.equal(buildSnapshot(node).reviews.length, 0);
});

test("pickProjectItem filters by project number and reads the current lane", () => {
  const node = prNode({
    projectItems: {
      nodes: [
        {id: "ITEM_OTHER", project: {number: 12}, fieldValueByName: {name: "Done"}},
        {id: "ITEM_75", project: {number: 75}, fieldValueByName: {name: "In Progress"}},
      ],
    },
  });
  assert.deepEqual(pickProjectItem(node, 75), {itemId: "ITEM_75", currentLane: "In Progress"});
  assert.equal(pickProjectItem(node, 99), null);
});

test("pickProjectItem handles a card with no status set", () => {
  const node = prNode({projectItems: {nodes: [{id: "ITEM_75", project: {number: 75}, fieldValueByName: null}]}});
  assert.deepEqual(pickProjectItem(node, 75), {itemId: "ITEM_75", currentLane: null});
});
