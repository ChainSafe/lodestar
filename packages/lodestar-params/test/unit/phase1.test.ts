import {expect} from "chai";
import fs from "fs";
import {load} from "js-yaml";
import path from "path";
import {IPhase1Params} from "../../src/phase1";
import {createParams, schema} from "../../src/utils";

describe("phase1", function () {
  it("should load all mainnet params", function () {
    const params = createParams<IPhase1Params>(
      load(fs.readFileSync(path.join(__dirname, "../../src/phase1/presets/mainnet.yaml"), "utf-8"), {schema})
    );
    Object.keys(params).forEach((key) => {
      if (key[0].toUpperCase() === key[0]) {
        expect(params[key as keyof IPhase1Params]).to.not.be.null;
        expect(params[key as keyof IPhase1Params]).to.not.be.undefined;
      }
    });
  });
  it("should load all minimal params", function () {
    const params = createParams<IPhase1Params>(
      load(fs.readFileSync(path.join(__dirname, "../../src/phase1/presets/minimal.yaml"), "utf-8"), {schema})
    );
    Object.keys(params).forEach((key) => {
      if (key[0].toUpperCase() === key[0]) {
        expect(params[key as keyof IPhase1Params]).to.not.be.null;
        expect(params[key as keyof IPhase1Params]).to.not.be.undefined;
      }
    });
  });
});
