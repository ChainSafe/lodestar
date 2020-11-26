import {expect} from "chai";
import fs from "fs";
import {load} from "js-yaml";
import path from "path";
import {IBeaconParams} from "../../src";
import {createParams, schema} from "../../src/utils";
import {BeaconParams} from "../../src/beaconParams";

describe("phase0", function () {
  it("should load all mainnet params", function () {
    const params = createParams<IBeaconParams>(
      load(fs.readFileSync(path.join(__dirname, "../../src/presets/mainnet.yaml"), "utf-8"), {schema}),
      BeaconParams
    );
    Object.keys(params).forEach((key) => {
      if (key[0].toUpperCase() === key[0]) {
        expect(params[key as keyof IBeaconParams]).to.not.be.null;
        expect(params[key as keyof IBeaconParams]).to.not.be.undefined;
      }
    });
  });
  it("should load all minimal params", function () {
    const params = createParams<IBeaconParams>(
      load(fs.readFileSync(path.join(__dirname, "../../src/presets/minimal.yaml"), "utf-8"), {schema}),
      BeaconParams
    );
    Object.keys(params).forEach((key) => {
      if (key[0].toUpperCase() === key[0]) {
        expect(params[key as keyof IBeaconParams]).to.not.be.null;
        expect(params[key as keyof IBeaconParams]).to.not.be.undefined;
      }
    });
  });
});
