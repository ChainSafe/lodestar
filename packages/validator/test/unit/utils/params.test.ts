import {chainConfigToJson} from "@chainsafe/lodestar-config";
import {chainConfig} from "@chainsafe/lodestar-config/default";
import {expect} from "chai";
import {assertEqualParams, NotEqualParamsError} from "../../../src/util/params.js";

describe("utils / params / assertEqualParams", () => {
  it("default == default", () => {
    const chainConfigJson = chainConfigToJson(chainConfig);
    assertEqualParams(chainConfig, chainConfigJson);
  });

  it("default != other", () => {
    const chainConfigJson = chainConfigToJson(chainConfig);

    // Force ALTAIR_FORK_EPOCH value to be different
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const otherConfig = {...chainConfigJson, ALTAIR_FORK_EPOCH: String(chainConfig.ALTAIR_FORK_EPOCH + 1)};

    expect(() => assertEqualParams(chainConfig, otherConfig)).to.throw(NotEqualParamsError);
  });

  it("should fill missing remote values with default and be equal", () => {
    const chainConfigJson = chainConfigToJson(chainConfig);
    delete chainConfigJson["DEPOSIT_CONTRACT_ADDRESS"];
    assertEqualParams(chainConfig, chainConfigJson);
  });
});
