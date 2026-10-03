import assert from "node:assert/strict";
import {afterEach, test, vi} from "vitest";
import {
  assertConnectionComplete,
  listOpenManagedBoardPrs,
  TRUNCATED_CONNECTION_ERROR_CODE,
  TruncatedConnectionError,
} from "../src/github.ts";

afterEach(() => vi.unstubAllGlobals());

test("complete GraphQL windows are accepted", () => {
  assert.doesNotThrow(() => assertConnectionComplete("ChainSafe/lodestar#9732", "reviews", {hasPreviousPage: false}));
  assert.doesNotThrow(() => assertConnectionComplete("ChainSafe project #75", "fields", {hasNextPage: false}));
});

for (const testCase of [
  {connection: "fields", pageInfo: {hasNextPage: true}},
  {connection: "reviewRequests", pageInfo: {hasNextPage: true}},
  {connection: "reviews", pageInfo: {hasPreviousPage: true}},
  {connection: "timelineItems", pageInfo: {hasPreviousPage: true}},
  {connection: "projectItems", pageInfo: {hasNextPage: true}},
]) {
  test(`truncated ${testCase.connection} window fails with context`, () => {
    assert.throws(
      () => assertConnectionComplete("ChainSafe/lodestar#9732", testCase.connection, testCase.pageInfo),
      (error: unknown) => {
        assert.ok(error instanceof TruncatedConnectionError);
        assert.equal(error.code, TRUNCATED_CONNECTION_ERROR_CODE);
        assert.deepEqual(error.metadata, {
          resource: "ChainSafe/lodestar#9732",
          connection: testCase.connection,
        });
        return true;
      },
    );
  });
}

test("sweep listing excludes statusless and unmanaged lanes", async () => {
  const item = (number: number, lane: string | null, state = "OPEN") => ({
    content: {
      __typename: "PullRequest",
      number,
      state,
      repository: {name: "lodestar", owner: {login: "ChainSafe"}},
    },
    fieldValueByName: lane === null ? null : {name: lane},
  });
  const data = {
    organization: {
      projectV2: {
        items: {
          pageInfo: {hasNextPage: false, endCursor: null},
          nodes: [
            item(1, "In Progress"),
            item(2, "Review Requested"),
            item(3, "Awaiting Author"),
            item(4, "Ready"),
            item(5, null),
            item(6, "Backlog"),
            item(7, "Done"),
            item(8, "In Progress", "CLOSED"),
          ],
        },
      },
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({data}), {status: 200})),
  );

  assert.deepEqual(await listOpenManagedBoardPrs("token", "ChainSafe", 75), [
    {owner: "ChainSafe", repo: "lodestar", number: 1},
    {owner: "ChainSafe", repo: "lodestar", number: 2},
    {owner: "ChainSafe", repo: "lodestar", number: 3},
  ]);
});
