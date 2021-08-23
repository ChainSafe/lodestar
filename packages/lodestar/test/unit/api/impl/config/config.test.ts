// eslint-disable-next-line no-restricted-imports
import * as params from "@chainsafe/lodestar-params";
import {chainConfig, config} from "@chainsafe/lodestar-config/default";
import {expect} from "chai";
import {getConfigApi} from "../../../../../src/api/impl/config";

describe("config api implementation", function () {
  let api: ReturnType<typeof getConfigApi>;

  beforeEach(function () {
    api = getConfigApi({config});
  });

  describe("getForkSchedule", function () {
    it("should get known scheduled forks", async function () {
      // @TODO: implement the actual fork schedule data get from config params once marin's altair PRs have been merged
      const {data: forkSchedule} = await api.getForkSchedule();
      expect(forkSchedule.length).to.equal(0);
    });
  });

  describe("getDepositContract", function () {
    it("should get the deposit contract from config", async function () {
      const {data: depositContract} = await api.getDepositContract();
      expect(depositContract.address).to.equal(config.DEPOSIT_CONTRACT_ADDRESS);
      expect(depositContract.chainId).to.equal(config.DEPOSIT_CHAIN_ID);
    });
  });

  describe("getSpec", function () {
    it("should get the spec", async function () {
      const {data: spec} = await api.getSpec();
      const expected: Record<string, unknown> = {...params, ...chainConfig};
      delete expected.ACTIVE_PRESET;
      delete expected.setActivePreset;
      expect(spec).to.deep.equal(expected);
    });
  });
});
