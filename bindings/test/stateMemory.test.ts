import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {expect, it} from "vitest";

it("reclaims discarded native states under memory pressure without explicit GC", {timeout: 40_000}, () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", fileURLToPath(new URL("./fixtures/stateMemory.ts", import.meta.url))],
    {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8",
      env: {...process.env, LODESTAR_Z_NODE_POOL_CAPACITY: "10000000", NODE_OPTIONS: ""},
      timeout: 30_000,
    }
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim()).toBe("completed");
});
