import assert from "node:assert/strict";
import {test} from "vitest";
import {assertConnectionComplete, TRUNCATED_CONNECTION_ERROR_CODE, TruncatedConnectionError} from "../src/github.ts";

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
