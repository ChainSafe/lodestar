import {expect} from "chai";
import {IBeaconParams} from "../../src";
import {BeaconParams} from "../../src/beaconParams";
import {mainnetYaml} from "../../src/presets/mainnetYaml";
import {minimalYaml} from "../../src/presets/minimalYaml";
import {createParams, mapValuesNumToString} from "../../src/utils";

describe("phase0", function () {
  it("should load all mainnet params", function () {
    const params = createParams<IBeaconParams>(mapValuesNumToString(mainnetYaml), BeaconParams);
    Object.keys(params).forEach((key) => {
      if (key[0].toUpperCase() === key[0]) {
        expect(params[key as keyof IBeaconParams]).to.not.be.null;
        expect(params[key as keyof IBeaconParams]).to.not.be.undefined;
      }
    });
  });
  it("should load all minimal params", function () {
    const params = createParams<IBeaconParams>(mapValuesNumToString(minimalYaml), BeaconParams);
    Object.keys(params).forEach((key) => {
      if (key[0].toUpperCase() === key[0]) {
        expect(params[key as keyof IBeaconParams]).to.not.be.null;
        expect(params[key as keyof IBeaconParams]).to.not.be.undefined;
      }
    });
  });
});
