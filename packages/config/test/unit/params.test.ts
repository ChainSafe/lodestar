import {describe, expect, it} from "vitest";
import {chainConfig} from "../../src/default.js";
import {ChainConfig, NotEqualParamsError, SpecJson, assertEqualParams, chainConfigToJson} from "../../src/index.js";
import {networksChainConfig} from "../../src/networks.js";
import {
  grandineHoodiConfig,
  lighthouseHoodiConfig,
  nimbusHoodiConfig,
  prysmHoodiConfig,
  tekuHoodiConfig,
} from "./interopConfigs.js";

const testCases: {name: string; items: [ChainConfig, SpecJson]}[] = [
  {name: "lighthouse", items: [networksChainConfig.hoodi, lighthouseHoodiConfig]},
  {name: "prysm", items: [networksChainConfig.hoodi, prysmHoodiConfig]},
  {name: "teku", items: [networksChainConfig.hoodi, tekuHoodiConfig]},
  {name: "nimbus", items: [networksChainConfig.hoodi, nimbusHoodiConfig]},
  {name: "grandine", items: [networksChainConfig.hoodi, grandineHoodiConfig]},
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
    delete chainConfigJson["DEPOSIT_CONTRACT_ADDRESS"];
    assertEqualParams(chainConfig, chainConfigJson);
  });

  for (const {name, items} of testCases) {
    it(`${name} hoodi == lodestar hoodi`, () => {
      assertEqualParams(items[0], items[1]);
    });
  }
});
