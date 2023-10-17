import {describe, it, expect, beforeEach} from "vitest";
import {config} from "@lodestar/config/default";
import {getConfigApi, renderJsonSpec} from "../../../../../src/api/impl/config/index.js";

describe("config api implementation", function () {
  let api: ReturnType<typeof getConfigApi>;

  beforeEach(function () {
    api = getConfigApi({config});
  });

  describe("getForkSchedule", function () {
    it("should get known scheduled forks", async function () {
      const {data: forkSchedule} = await api.getForkSchedule();
      expect(forkSchedule.length).toBe(Object.keys(config.forks).length);
    });
  });

  describe("getDepositContract", function () {
    it("should get the deposit contract from config", async function () {
      const {data: depositContract} = await api.getDepositContract();
      expect(depositContract.address).toBe(config.DEPOSIT_CONTRACT_ADDRESS);
      expect(depositContract.chainId).toBe(config.DEPOSIT_CHAIN_ID);
    });
  });

  describe("getSpec", function () {
    it("Ensure spec can be rendered", () => {
      renderJsonSpec(config);
    });

    it("should get the spec", async function () {
      const {data: specJson} = await api.getSpec();

      expect(specJson.SECONDS_PER_ETH1_BLOCK).toBe("14");
      expect(specJson.DEPOSIT_CONTRACT_ADDRESS).toBe("0x1234567890123456789012345678901234567890");
    });
  });
});
