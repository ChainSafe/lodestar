import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {expect, it} from "vitest";
import type {ReleaseScenario} from "./fixtures/stateRelease.js";

it("reclaims released states while their wrappers remain reachable without GC", {timeout: 40_000}, () => {
  runProcess("retained wrappers");
});

it("keeps descendants usable after release and finalization of their owners", {timeout: 40_000}, () => {
  runProcess("retained descendants", true);
});

it.each([
  "slot options getter",
  "transition options getter",
  "block rewards getter",
  "block rewards output setter",
  "Map construction and set callbacks",
  "Set membership callback",
  "inherited output setter",
  "nested output setter",
  "throwing options getter",
] satisfies ReleaseScenario[])("retains the active state through release in a %s", {timeout: 40_000}, (scenario) => {
  runProcess(scenario);
});

function runProcess(scenario: ReleaseScenario, exposeGc = false): void {
  const result = spawnSync(
    process.execPath,
    [
      ...(exposeGc ? ["--expose-gc"] : []),
      "--import",
      "tsx",
      fileURLToPath(new URL("./fixtures/stateRelease.ts", import.meta.url)),
      scenario,
    ],
    {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8",
      env: {...process.env, LODESTAR_Z_NODE_POOL_CAPACITY: "500000", NODE_OPTIONS: ""},
      timeout: 30_000,
    }
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim()).toBe("completed");
}
