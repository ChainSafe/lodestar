import {describe, expect, it} from "vitest";
import {BeaconHealth, renderEnumNumeric} from "../../../src/metrics.js";

describe("renderEnumNumeric", () => {
  it("BeaconHealth", () => {
    expect(renderEnumNumeric(BeaconHealth)).toBe("READY=0, SYNCING=1, ERROR=2");
  });
});
