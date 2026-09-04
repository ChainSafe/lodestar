import {beforeEach, describe, expect, it} from "vitest";
import {routes} from "@lodestar/api";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
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
      expect(specJson.DEPOSIT_CONTRACT_ADDRESS).toBe("0x00000000219ab540356cbb839cbe05303d7705fa");
      expect(specJson.DEPOSIT_REQUEST_TYPE).toBe("0x00");
    });

    it("omits GAS_LIMIT_SCHEDULE when Gloas is unscheduled", () => {
      const specJson = renderJsonSpec(
        createChainForkConfig({
          ...defaultChainConfig,
          GLOAS_FORK_EPOCH: Infinity,
          GAS_LIMIT_SCHEDULE: [],
        })
      );

      expect(specJson).not.toHaveProperty("GAS_LIMIT_SCHEDULE");
    });

    it("includes empty GAS_LIMIT_SCHEDULE when Gloas is scheduled", () => {
      const specJson = renderJsonSpec(
        createChainForkConfig({
          ...defaultChainConfig,
          GLOAS_FORK_EPOCH: 10,
          GAS_LIMIT_SCHEDULE: [],
        })
      );

      expect(specJson.GAS_LIMIT_SCHEDULE).toEqual([]);
    });

    it("includes GAS_LIMIT_SCHEDULE when Gloas is scheduled with entries", () => {
      const specJson = renderJsonSpec(
        createChainForkConfig({
          ...defaultChainConfig,
          GLOAS_FORK_EPOCH: 10,
          GAS_LIMIT_SCHEDULE: [{EPOCH: 10, GAS_LIMIT: 60_000_000}],
        })
      );

      expect(specJson.GAS_LIMIT_SCHEDULE).toEqual([{EPOCH: "10", GAS_LIMIT: "60000000"}]);
    });

    it("still omits BLOB_SCHEDULE when Fulu is unscheduled", () => {
      const specJson = renderJsonSpec(
        createChainForkConfig({
          ...defaultChainConfig,
          FULU_FORK_EPOCH: Infinity,
          BLOB_SCHEDULE: [],
        })
      );

      expect(specJson).not.toHaveProperty("BLOB_SCHEDULE");
    });
  });
});
