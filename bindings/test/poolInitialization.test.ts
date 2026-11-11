import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {expect, it} from "vitest";
import type {PoolScenario} from "./fixtures/poolInitialization.js";

it("keeps BLS and configuration-only environments below the unused pool allocation", {timeout: 30_000}, () => {
  runProcess("idle environments");
});

it("defers invalid capacity until state creation and retries failed pool initialization", {timeout: 30_000}, () => {
  runProcess("invalid capacity", "invalid");
});

function runProcess(scenario: PoolScenario, capacity = "10000000"): void {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", fileURLToPath(new URL("./fixtures/poolInitialization.ts", import.meta.url)), scenario],
    {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8",
      env: {...process.env, LODESTAR_Z_NODE_POOL_CAPACITY: capacity, NODE_OPTIONS: ""},
      timeout: 20_000,
    }
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim()).toBe("completed");
}
