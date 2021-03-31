import {types as mainnetTypes} from "../../src/presets/mainnet";
import {types as minimalTypes} from "../../src/presets/minimal";
import {expect} from "chai";

describe("altair types", function () {
  it("should generate minimal and mainnet", function () {
    expect(Object.keys(mainnetTypes.altair).length).to.be.greaterThan(0);
    expect(Object.keys(minimalTypes.altair).length).to.be.greaterThan(0);
  });
});
