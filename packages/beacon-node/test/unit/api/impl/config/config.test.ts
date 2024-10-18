import {describe, it, expect, beforeEach} from "vitest";
import {routes} from "@lodestar/api";
import {config} from "@lodestar/config/default";
import {getConfigApi, renderJsonSpec} from "../../../../../src/api/impl/config/index.js";

describe("config api implementation", () => {
  let api: ReturnType<typeof getConfigApi>;

  beforeEach(() => {
    api = getConfigApi({config});
  });

  describe("getForkSchedule", () => {
    it("should get known scheduled forks", async () => {
      const {data: forkSchedule} = await api.getForkSchedule();
      expect(forkSchedule.length).toBe(Object.keys(config.forks).length);
    });
  });

  describe("getDepositContract", () => {
    it("should get the deposit contract from config", async () => {
      const {data: depositContract} = (await api.getDepositContract()) as {data: routes.config.DepositContract};
      expect(depositContract.address).toBe(config.DEPOSIT_CONTRACT_ADDRESS);
      expect(depositContract.chainId).toBe(config.DEPOSIT_CHAIN_ID);
    });
  });

  describe("getSpec", () => {
    it("Ensure spec can be rendered", () => {
      renderJsonSpec(config);
    });

    it("should get the spec", async () => {
      const {data: specJson} = (await api.getSpec()) as {data: routes.config.Spec};

      expect(specJson.SECONDS_PER_ETH1_BLOCK).toBe("14");
      expect(specJson.DEPOSIT_CONTRACT_ADDRESS).toBe("0x1234567890123456789012345678901234567890");
    });
  });
});
