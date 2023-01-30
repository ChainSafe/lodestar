import {expect} from "chai";
import {BeaconHealth, renderEnumNumeric} from "../../../src/metrics.js";

describe("renderEnumNumeric", () => {
  it("BeaconHealth", () => {
    expect(renderEnumNumeric(BeaconHealth)).equals(
      "READY=0, SYNCING=1, NOT_INITIALIZED_OR_ISSUES=2, UNKNOWN=3, ERROR=4"
    );
  });
});
