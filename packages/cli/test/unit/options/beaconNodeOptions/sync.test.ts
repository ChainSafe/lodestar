import {describe, expect, it} from "vitest";
import {type SyncArgs, parseArgs} from "../../../../src/options/beaconNodeOptions/sync.js";

describe("options / beaconNodeOptions / sync", () => {
  it("should map sync.targetSync=true to targetSync:true", () => {
    const args: SyncArgs = {"sync.targetSync": true};
    const result = parseArgs(args);
    expect(result.targetSync).toBe(true);
  });

  it("should map sync.targetSync omitted to targetSync:undefined", () => {
    const args: SyncArgs = {};
    const result = parseArgs(args);
    expect(result.targetSync).toBeUndefined();
  });

  it("should map sync.isSingleNode=true to isSingleNode:true (mirror check)", () => {
    const args: SyncArgs = {"sync.isSingleNode": true};
    const result = parseArgs(args);
    expect(result.isSingleNode).toBe(true);
  });

  it("should map sync.isSingleNode omitted to isSingleNode:undefined (mirror check)", () => {
    const args: SyncArgs = {};
    const result = parseArgs(args);
    expect(result.isSingleNode).toBeUndefined();
  });
});
