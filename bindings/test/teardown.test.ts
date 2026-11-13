import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

describe("BeaconStateView teardown", () => {
  it("creates view at module scope and exits cleanly", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", fileURLToPath(new URL("./fixtures/teardown.ts", import.meta.url))],
      {cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 60_000}
    );
    expect(result.status, `stdout=${result.stdout} stderr=${result.stderr}`).toBe(0);
    expect(result.stderr, "no panic on stderr").not.toContain("panic:");
  }, 90_000);
});
