import {describe, it, expect} from "vitest";
import {chainConfigToJson, ChainConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {networksChainConfig} from "@lodestar/config/networks";
import {assertEqualParams, NotEqualParamsError} from "../../../src/util/params.js";
import {lighthouseHoleskyConfig, prysmHoleskyConfig, tekuHoleskyConfig, nimbusHoleskyConfig} from "./interopConfigs.js";

const testCases: {name: string; items: [ChainConfig, Record<string, string>]}[] = [
  {name: "lighthouse", items: [networksChainConfig.holesky, lighthouseHoleskyConfig]},
  {name: "prysm", items: [networksChainConfig.holesky, prysmHoleskyConfig]},
  {name: "teku", items: [networksChainConfig.holesky, tekuHoleskyConfig]},
  {name: "nimbus", items: [networksChainConfig.holesky, nimbusHoleskyConfig]},
];

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
    // biome-ignore lint/performance/noDelete: Can not delete property with undefined assignment
    delete chainConfigJson["DEPOSIT_CONTRACT_ADDRESS"];
    assertEqualParams(chainConfig, chainConfigJson);
  });

  for (const {name, items} of testCases) {
    it(`${name} holesky == lodestar holesky`, () => {
      assertEqualParams(items[0], items[1]);
    });
  }
});
