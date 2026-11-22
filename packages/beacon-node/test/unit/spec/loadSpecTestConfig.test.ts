import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {loadSpecTestConfig} from "../../spec/utils/loadSpecTestConfig.js";

describe("loadSpecTestConfig", () => {
  let testCaseDir: string;

  beforeEach(() => {
    testCaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "lodestar-spec-config-"));
  });

  afterEach(() => {
    fs.rmSync(testCaseDir, {recursive: true, force: true});
  });

  it("returns no overrides when config.yaml is absent", () => {
    expect(loadSpecTestConfig(testCaseDir)).toEqual({});
  });

  it("preserves config types, hex bytes, uint64 limits and schedules", () => {
    fs.writeFileSync(
      path.join(testCaseDir, "config.yaml"),
      `CONFIG_NAME: spec-test
ALTAIR_FORK_EPOCH: 3
GLOAS_FORK_EPOCH: 18446744073709551615
GENESIS_FORK_VERSION: 0x00000001
TERMINAL_TOTAL_DIFFICULTY: 9007199254740993
BLOB_SCHEDULE:
  - EPOCH: 4
    MAX_BLOBS_PER_BLOCK: 12
GAS_LIMIT_SCHEDULE:
  - EPOCH: 18446744073709551615
    GAS_LIMIT: 60000000
UNKNOWN_SPEC_FIELD: 42
`
    );

    expect(loadSpecTestConfig(testCaseDir)).toEqual({
      CONFIG_NAME: "spec-test",
      ALTAIR_FORK_EPOCH: 3,
      GLOAS_FORK_EPOCH: Infinity,
      GENESIS_FORK_VERSION: Uint8Array.of(0, 0, 0, 1),
      TERMINAL_TOTAL_DIFFICULTY: 9007199254740993n,
      BLOB_SCHEDULE: [{EPOCH: 4, MAX_BLOBS_PER_BLOCK: 12}],
      GAS_LIMIT_SCHEDULE: [{EPOCH: Infinity, GAS_LIMIT: 60000000}],
    });
  });
});
