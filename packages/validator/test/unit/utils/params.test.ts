import {describe, expect, it} from "vitest";
import {chainConfigToJson} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {NotEqualParamsError, assertEqualParams} from "../../../src/util/params.js";

describe("utils / params / assertEqualParams", () => {
  it("default == default", () => {
    const chainConfigJson = chainConfigToJson(chainConfig);
    assertEqualParams(chainConfig, chainConfigJson);
  });

  it("default != other", () => {
    const ALTAIR_FORK_EPOCH = 10;
    const localConfig: typeof chainConfig = {...chainConfig, ALTAIR_FORK_EPOCH};
    const chainConfigJson = chainConfigToJson(localConfig);

    // Force ALTAIR_FORK_EPOCH value to be different
    const otherConfig = {...chainConfigJson, ALTAIR_FORK_EPOCH: String(ALTAIR_FORK_EPOCH + 1)};

    expect(() => assertEqualParams(localConfig, otherConfig)).toThrow(NotEqualParamsError);
  });

  it("should fill missing remote values with default and be equal", () => {
    const chainConfigJson = chainConfigToJson(chainConfig);
    delete chainConfigJson["DEPOSIT_CONTRACT_ADDRESS"];
    assertEqualParams(chainConfig, chainConfigJson);
  });
});
