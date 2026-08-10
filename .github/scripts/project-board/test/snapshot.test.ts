import assert from "node:assert/strict";
import {test} from "node:test";
import {buildSnapshot, pickProjectItem, type PrNode} from "../src/snapshot.ts";

type PrNodeOverrides = Partial<Omit<PrNode, "reviewRequests" | "reviews" | "timelineItems" | "projectItems">> & {
  reviewRequests?: Omit<PrNode["reviewRequests"], "pageInfo"> & {pageInfo?: PrNode["reviewRequests"]["pageInfo"]};
  reviews?: Omit<PrNode["reviews"], "pageInfo"> & {pageInfo?: PrNode["reviews"]["pageInfo"]};
  timelineItems?: Omit<PrNode["timelineItems"], "pageInfo"> & {pageInfo?: PrNode["timelineItems"]["pageInfo"]};
  projectItems?: Omit<PrNode["projectItems"], "pageInfo"> & {pageInfo?: PrNode["projectItems"]["pageInfo"]};
};

function prNode(overrides: PrNodeOverrides): PrNode {
  return {
    state: overrides.state ?? "OPEN",
    isDraft: overrides.isDraft ?? false,
    reviewRequests: {
      pageInfo: overrides.reviewRequests?.pageInfo ?? {hasNextPage: false},
      nodes: overrides.reviewRequests?.nodes ?? [],
    },
    reviews: {
      pageInfo: overrides.reviews?.pageInfo ?? {hasPreviousPage: false},
      nodes: overrides.reviews?.nodes ?? [],
    },
    timelineItems: {
      pageInfo: overrides.timelineItems?.pageInfo ?? {hasPreviousPage: false},
      nodes: overrides.timelineItems?.nodes ?? [],
    },
    projectItems: {
      pageInfo: overrides.projectItems?.pageInfo ?? {hasNextPage: false},
      nodes: overrides.projectItems?.nodes ?? [],
    },
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
        {
          __typename: "ReviewRequestedEvent",
          createdAt: "2026-01-01T00:00:00Z",
          requestedReviewer: {__typename: "User", login: "alice"},
        },
        {
          __typename: "ReviewRequestedEvent",
          createdAt: "2026-01-03T00:00:00Z",
          requestedReviewer: {__typename: "User", login: "alice"},
        },
        {
          __typename: "ReviewRequestedEvent",
          createdAt: "2026-01-04T00:00:00Z",
          requestedReviewer: {__typename: "Team", login: undefined},
        },
      ],
    },
  });
  const snap = buildSnapshot(node);
  assert.deepEqual(snap.pendingUserRequests, [{login: "alice", requestedAt: "2026-01-03T00:00:00Z"}]);
  assert.deepEqual(snap.reviewRequestSignals, [{login: "alice", requestedAt: "2026-01-03T00:00:00Z"}]);
});

test("pending request with no timeline event falls back to epoch", () => {
  const node = prNode({
    reviewRequests: {nodes: [{requestedReviewer: {__typename: "User", login: "alice"}}]},
  });
  const snap = buildSnapshot(node);
  assert.deepEqual(snap.pendingUserRequests, [{login: "alice", requestedAt: "1970-01-01T00:00:00Z"}]);
  assert.deepEqual(snap.reviewRequestSignals, [{login: "alice", requestedAt: "1970-01-01T00:00:00Z"}]);
});

test("completed re-request remains a signal while another reviewer is pending", () => {
  const node = prNode({
    reviewRequests: {nodes: [{requestedReviewer: {__typename: "User", login: "bob"}}]},
    timelineItems: {
      nodes: [
        {
          __typename: "ReviewRequestedEvent",
          createdAt: "2026-01-01T00:00:00Z",
          requestedReviewer: {__typename: "User", login: "bob"},
        },
        {
          __typename: "ReviewRequestedEvent",
          createdAt: "2026-01-03T00:00:00Z",
          requestedReviewer: {__typename: "User", login: "alice"},
        },
      ],
    },
  });

  assert.deepEqual(buildSnapshot(node).reviewRequestSignals, [
    {login: "bob", requestedAt: "2026-01-01T00:00:00Z"},
    {login: "alice", requestedAt: "2026-01-03T00:00:00Z"},
  ]);
});

test("explicit removal cancels only the latest request signal for a reviewer", () => {
  const node = prNode({
    reviewRequests: {nodes: [{requestedReviewer: {__typename: "User", login: "bob"}}]},
    timelineItems: {
      nodes: [
        {
          __typename: "ReviewRequestedEvent",
          createdAt: "2026-01-01T00:00:00Z",
          requestedReviewer: {__typename: "User", login: "bob"},
        },
        {
          __typename: "ReviewRequestedEvent",
          createdAt: "2026-01-02T00:00:00Z",
          requestedReviewer: {__typename: "User", login: "alice"},
        },
        {
          __typename: "ReviewRequestedEvent",
          createdAt: "2026-01-03T00:00:00Z",
          requestedReviewer: {__typename: "User", login: "alice"},
        },
        {
          __typename: "ReviewRequestRemovedEvent",
          createdAt: "2026-01-04T00:00:00Z",
          requestedReviewer: {__typename: "User", login: "alice"},
        },
      ],
    },
  });

  assert.deepEqual(buildSnapshot(node).reviewRequestSignals, [
    {login: "bob", requestedAt: "2026-01-01T00:00:00Z"},
    {login: "alice", requestedAt: "2026-01-02T00:00:00Z"},
  ]);
});

test("latest ready-for-review or reopened event starts the review cycle", () => {
  const node = prNode({
    timelineItems: {
      nodes: [
        {__typename: "ReadyForReviewEvent", createdAt: "2026-01-01T00:00:00Z"},
        {__typename: "ReopenedEvent", createdAt: "2026-01-03T00:00:00Z"},
        {__typename: "ReadyForReviewEvent", createdAt: "2026-01-02T00:00:00Z"},
      ],
    },
  });

  assert.equal(buildSnapshot(node).reviewCycleStartedAt, "2026-01-03T00:00:00Z");
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

test("pickProjectItem distinguishes projects with the same number by id", () => {
  const node = prNode({
    projectItems: {
      nodes: [
        {id: "ITEM_OTHER", project: {id: "PROJECT_OTHER", number: 75}, fieldValueByName: {name: "Done"}},
        {id: "ITEM_75", project: {id: "PROJECT_75", number: 75}, fieldValueByName: {name: "In Progress"}},
      ],
    },
  });
  assert.deepEqual(pickProjectItem(node, "PROJECT_75"), {itemId: "ITEM_75", currentLane: "In Progress"});
  assert.equal(pickProjectItem(node, "PROJECT_MISSING"), null);
});

test("pickProjectItem handles a card with no status set", () => {
  const node = prNode({
    projectItems: {nodes: [{id: "ITEM_75", project: {id: "PROJECT_75", number: 75}, fieldValueByName: null}]},
  });
  assert.deepEqual(pickProjectItem(node, "PROJECT_75"), {itemId: "ITEM_75", currentLane: null});
});
