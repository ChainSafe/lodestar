import {beforeAll, describe, expect, it, vi} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {phase0, ssz} from "@lodestar/types";
import {getBeaconApi} from "../../../../../src/api/impl/beacon/index.js";
import {ProposerPreferencesPool} from "../../../../../src/chain/opPools/proposerPreferencesPool.js";
import {ApiTestModules, getApiTestModules} from "../../../../utils/api.js";
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

  describe("getProposerPreferences", () => {
    const gloasConfig = createChainForkConfig({
      ...defaultChainConfig,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
      GLOAS_FORK_EPOCH: 0,
    });

    it("returns the known preferences, optionally of a single slot", async () => {
      const gloasModules = getApiTestModules({config: gloasConfig});
      const gloasApi = getBeaconApi({...gloasModules, config: gloasConfig});
      vi.spyOn(gloasModules.chain.clock, "currentSlot", "get").mockReturnValue(1);
      const pool = new ProposerPreferencesPool();
      (gloasModules.chain as Mutable<typeof gloasModules.chain, "proposerPreferencesPool">).proposerPreferencesPool =
        pool;
      const preferences = [5, 6].map((proposalSlot) => {
        const signed = ssz.gloas.SignedProposerPreferences.defaultValue();
        signed.message.proposalSlot = proposalSlot;
        pool.add(signed);
        return signed;
      });

      expect(await gloasApi.getProposerPreferences({})).toEqual({data: preferences, meta: {version: ForkName.gloas}});
      expect(await gloasApi.getProposerPreferences({slot: 6})).toEqual({
        data: [preferences[1]],
        meta: {version: ForkName.gloas},
      });
    });

    it("rejects a request before Gloas", async () => {
      vi.spyOn(modules.chain.clock, "currentSlot", "get").mockReturnValue(1);

      await expect(api.getProposerPreferences({})).rejects.toMatchObject({statusCode: 400});
    });
  });
});
