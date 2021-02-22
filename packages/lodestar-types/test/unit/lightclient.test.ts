import {types as mainnetTypes} from "../../src/presets/mainnet";
import {types as minimalTypes} from "../../src/presets/minimal";
import {expect} from "chai";

describe("lightclient types", function () {
  it("should generate minimal and mainnet", function () {
    expect(Object.keys(mainnetTypes.lightclient).length).to.be.greaterThan(0);
    expect(Object.keys(minimalTypes.lightclient).length).to.be.greaterThan(0);
  });
});
