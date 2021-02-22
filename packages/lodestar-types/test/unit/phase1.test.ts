import {types as mainnetTypes} from "../../src/presets/mainnet";
import {types as minimalTypes} from "../../src/presets/minimal";
import {expect} from "chai";

describe("phase1 types", function () {
  it("should generate minimal and mainnet", function () {
    expect(Object.keys(mainnetTypes.phase1).length).to.be.greaterThan(0);
    expect(Object.keys(minimalTypes.phase1).length).to.be.greaterThan(0);
  });
});
