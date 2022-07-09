import {expect} from "chai";
import {chainConfigToJson, IChainConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {networksChainConfig} from "@lodestar/config/networks";
import {assertEqualParams, NotEqualParamsError} from "../../../src/util/params.js";
import {lightHouseKilnConfig, prysmKilnConfig, tekuKilnConfig, nimbusKilnConfig} from "./interopConfigs.js";

const testCases: {name: string; items: [IChainConfig, Record<string, string>]}[] = [
  {name: "lighthouse", items: [networksChainConfig.kiln, lightHouseKilnConfig]},
  {name: "prysm", items: [networksChainConfig.kiln, prysmKilnConfig]},
  {name: "teku", items: [networksChainConfig.kiln, tekuKilnConfig]},
  {name: "nimbus", items: [networksChainConfig.kiln, nimbusKilnConfig]},
];

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

  for (const {name, items} of testCases) {
    it(`${name} kiln == lodestar kiln`, () => {
      assertEqualParams(items[0], items[1]);
    });
  }
});
