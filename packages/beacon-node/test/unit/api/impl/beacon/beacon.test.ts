import {describe, it, expect, beforeAll} from "vitest";
import {phase0} from "@lodestar/types";
import {ApiTestModules, getApiTestModules} from "../../../../utils/api.js";
import {getBeaconApi} from "../../../../../src/api/impl/beacon/index.js";
import {Mutable} from "../../../../utils/types.js";

describe("beacon api implementation", () => {
  let modules: ApiTestModules;
  let api: ReturnType<typeof getBeaconApi>;

  beforeAll(() => {
    modules = getApiTestModules();
    api = getBeaconApi(modules);
  });

  describe("getGenesis", () => {
    it("success", async () => {
      (modules.chain as Mutable<typeof modules.chain, "genesisTime">).genesisTime = 0;
      (modules.chain as Mutable<typeof modules.chain, "genesisValidatorsRoot">).genesisValidatorsRoot =
        Buffer.alloc(32);
      const {data: genesis} = (await api.getGenesis()) as {data: phase0.Genesis};
      if (genesis === null || genesis === undefined) throw Error("Genesis is nullish");
      expect(genesis.genesisForkVersion).toBeDefined();
      expect(genesis.genesisTime).toBeDefined();
      expect(genesis.genesisValidatorsRoot).toBeDefined();
    });
  });
});
