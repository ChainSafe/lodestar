import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";
import type {BoundaryScenario} from "./fixtures/stateBoundary.js";

describe("native state transition boundaries", () => {
  it.each([
    ["missing config", "Method expects at least 2 arguments"],
    ["invalid config undefined", "Cannot convert undefined or null to object"],
    ["invalid config null", "Cannot convert undefined or null to object"],
    ["invalid config {}", "Argument 2 must be an instance of BeaconConfig"],
    ["invalid config Object.create(bindings.BeaconConfig.prototype)", "Argument 2 must be an instance of BeaconConfig"],
    ["invalid config state", "Argument 2 must be an instance of BeaconConfig"],
    ["truncated state", "InvalidStateBytes"],
    ["truncated block", "InvalidSignedBlockBytes"],
    ["invalid signed block offset", "InvalidSignedBlockBytes"],
    ["noncanonical signed block offset", "InvalidSignedBlockBytes"],
    ["negative slot", "InvalidSlot"],
    ["fractional slot", "InvalidSlot"],
    ["negative block-root slot", "InvalidSlot"],
    ["negative validator index", "InvalidUnsignedInteger"],
    ["unsafe validator index", "InvalidUnsignedInteger"],
    ["infinite validator index", "InvalidUnsignedInteger"],
    ["NaN validator index", "InvalidUnsignedInteger"],
    ["fractional committee epoch", "InvalidUnsignedInteger"],
    ["zero proof index", "Failed to get single proof"],
    ["truncated loaded state", "InvalidStateBytes"],
  ] satisfies [BoundaryScenario, string][])("rejects %s without aborting", (scenario, error) => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", fileURLToPath(new URL("./fixtures/stateBoundary.ts", import.meta.url)), scenario, error],
      {cwd: new URL("../..", import.meta.url), encoding: "utf8", timeout: 30_000}
    );
    expect(result.signal, result.stderr).toBeNull();
    expect(result.status, result.stderr).toBe(0);
  });
});
