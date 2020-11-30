import {expect} from "chai";
import {IPhase1Params} from "../../src/phase1";
import {mainnetYaml} from "../../src/phase1/presets/mainnetYaml";
import {minimalYaml} from "../../src/phase1/presets/minimalYaml";
import {Phase1Params} from "../../src/phase1/ssz";
import {createParams, mapValuesNumToString} from "../../src/utils";

describe("phase1", function () {
  it("should load all mainnet params", function () {
    const params = createParams<IPhase1Params>(mapValuesNumToString(mainnetYaml), Phase1Params);
    expect(Object.keys(params).length).to.be.greaterThan(0);
    Object.keys(params).forEach((key) => {
      if (key[0].toUpperCase() === key[0]) {
        expect(params[key as keyof IPhase1Params]).to.not.be.null;
        expect(params[key as keyof IPhase1Params]).to.not.be.undefined;
      }
    });
  });
  it("should load all minimal params", function () {
    const params = createParams<IPhase1Params>(mapValuesNumToString(minimalYaml), Phase1Params);
    expect(Object.keys(params).length).to.be.greaterThan(0);
    Object.keys(params).forEach((key) => {
      if (key[0].toUpperCase() === key[0]) {
        expect(params[key as keyof IPhase1Params]).to.not.be.null;
        expect(params[key as keyof IPhase1Params]).to.not.be.undefined;
      }
    });
  });
});
