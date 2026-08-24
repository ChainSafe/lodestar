import assert from "node:assert/strict";
import {test} from "vitest";
import type {BoardPr} from "../src/github.ts";
import {
  reconcileSweep,
  SWEEP_RECONCILIATION_FAILED_CODE,
  type SweepFailure,
  SweepReconciliationError,
} from "../src/sweep.ts";

const prs: BoardPr[] = [
  {owner: "ChainSafe", repo: "lodestar", number: 1},
  {owner: "ChainSafe", repo: "ssz", number: 2},
  {owner: "ChainSafe", repo: "gossipsub", number: 3},
];

test("sweep attempts every PR before reporting aggregate failures", async () => {
  const attempted: string[] = [];
  const logged: SweepFailure[] = [];

  await assert.rejects(
    reconcileSweep(
      prs,
      async (pr) => {
        const label = `${pr.owner}/${pr.repo}#${pr.number}`;
        attempted.push(label);
        if (pr.repo === "ssz") throw new Error("GraphQL temporarily unavailable");
      },
      (failure) => logged.push(failure),
    ),
    (error: unknown) => {
      assert.ok(error instanceof SweepReconciliationError);
      assert.equal(error.code, SWEEP_RECONCILIATION_FAILED_CODE);
      assert.deepEqual(error.metadata, {
        attempted: 3,
        failed: 1,
        failedPrs: ["ChainSafe/ssz#2"],
      });
      return true;
    },
  );

  assert.deepEqual(attempted, ["ChainSafe/lodestar#1", "ChainSafe/ssz#2", "ChainSafe/gossipsub#3"]);
  assert.deepEqual(logged, [{pr: "ChainSafe/ssz#2", error: "GraphQL temporarily unavailable"}]);
});

test("sweep completes successfully when every PR reconciles", async () => {
  const attempted: number[] = [];
  await reconcileSweep(prs, async (pr) => {
    attempted.push(pr.number);
  });
  assert.deepEqual(attempted, [1, 2, 3]);
});
