import {beforeAll, describe, expect, it, vi} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
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
      vi.spyOn(gloasModules.chain.clock, "currentEpoch", "get").mockReturnValue(0);
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

    it("returns the preferences of the first Gloas slots in the epoch before the fork", async () => {
      const preGloasConfig = createChainForkConfig({...gloasConfig, GLOAS_FORK_EPOCH: 1});
      const preGloasModules = getApiTestModules({config: preGloasConfig});
      const preGloasApi = getBeaconApi({...preGloasModules, config: preGloasConfig});
      vi.spyOn(preGloasModules.chain.clock, "currentEpoch", "get").mockReturnValue(0);
      const pool = new ProposerPreferencesPool();
      (
        preGloasModules.chain as Mutable<typeof preGloasModules.chain, "proposerPreferencesPool">
      ).proposerPreferencesPool = pool;
      const preferences = ssz.gloas.SignedProposerPreferences.defaultValue();
      preferences.message.proposalSlot = SLOTS_PER_EPOCH;
      pool.add(preferences);

      expect(await preGloasApi.getProposerPreferences({})).toEqual({
        data: [preferences],
        meta: {version: ForkName.gloas},
      });
      await expect(preGloasApi.getProposerPreferences({slot: SLOTS_PER_EPOCH - 1})).rejects.toMatchObject({
        statusCode: 400,
      });
    });

    it("rejects a request if Gloas is not active within the next epoch", async () => {
      vi.spyOn(modules.chain.clock, "currentEpoch", "get").mockReturnValue(0);

      await expect(api.getProposerPreferences({})).rejects.toMatchObject({statusCode: 400});
    });
  });
});
