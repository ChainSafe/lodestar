import {chainConfig as mainnetConfig} from "@chainsafe/lodestar-config/mainnet";
import {chainConfig as minimalConfig} from "@chainsafe/lodestar-config/minimal";
import {expect} from "chai";
import {assertEqualParams, NotEqualParamsError} from "../../../src/util/params";

describe("utils / params / assertEqualParams", () => {
  it("mainnet == mainnet", () => {
    assertEqualParams(mainnetConfig, mainnetConfig);
  });

  it("minimal == minimal", () => {
    assertEqualParams(minimalConfig, minimalConfig);
  });

  it("mainnet != minimal", () => {
    expect(() => assertEqualParams(mainnetConfig, minimalConfig)).to.throw(NotEqualParamsError);
  });

  it("minimal != mainnet", () => {
    expect(() => assertEqualParams(minimalConfig, mainnetConfig)).to.throw(NotEqualParamsError);
  });
});
