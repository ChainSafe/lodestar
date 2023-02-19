import {expect} from "chai";
import {chainConfigToJson, ChainConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {networksChainConfig} from "@lodestar/config/networks";
import {assertEqualParams, NotEqualParamsError} from "../../../src/util/params.js";
import {lightHouseRopstenConfig, prysmRopstenConfig, tekuRopstenConfig, nimbusRopstenConfig} from "./interopConfigs.js";

const testCases: {name: string; items: [ChainConfig, Record<string, string>]}[] = [
  {name: "lighthouse", items: [networksChainConfig.ropsten, lightHouseRopstenConfig]},
  {name: "prysm", items: [networksChainConfig.ropsten, prysmRopstenConfig]},
  {name: "teku", items: [networksChainConfig.ropsten, tekuRopstenConfig]},
  {name: "nimbus", items: [networksChainConfig.ropsten, nimbusRopstenConfig]},
];

/* eslint-disable @typescript-eslint/naming-convention */

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

    expect(() => assertEqualParams(localConfig, otherConfig)).to.throw(NotEqualParamsError);
  });

  it("should fill missing remote values with default and be equal", () => {
    const chainConfigJson = chainConfigToJson(chainConfig);
    delete chainConfigJson["DEPOSIT_CONTRACT_ADDRESS"];
    assertEqualParams(chainConfig, chainConfigJson);
  });

  for (const {name, items} of testCases) {
    it(`${name} ropsten == lodestar ropsten`, () => {
      assertEqualParams(items[0], items[1]);
    });
  }
});
