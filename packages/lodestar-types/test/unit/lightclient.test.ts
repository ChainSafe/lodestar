import {types as mainnetTypes} from "../../src/ssz/presets/mainnet";
import {types as minimalTypes} from "../../src/ssz/presets/minimal";
import {expect} from "chai";

describe("phase1 types", function () {
  it("should generate minimal and mainnet", function () {
    expect(Object.keys(mainnetTypes.lightclient).length).to.be.greaterThan(0);
    expect(Object.keys(minimalTypes.lightclient).length).to.be.greaterThan(0);
  });
});
