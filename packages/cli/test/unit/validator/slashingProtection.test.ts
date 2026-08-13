import {FastifyInstance} from "fastify";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {BeaconApiMethods, registerRoutes} from "@lodestar/api/beacon/server";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {genesisData} from "@lodestar/config/networks";
import {ssz} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {getTestServer} from "../../../../api/test/utils/utils.js";
import {getGenesisValidatorsRoot} from "../../../src/cmds/validator/slashingProtection/utils.js";

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

describe("validator / slashingProtection", () => {
  it("uses cached network genesis validators root for static-root networks", async () => {
    const mainnetGenesisValidatorsRoot = genesisData.mainnet.genesisValidatorsRoot;
    if (mainnetGenesisValidatorsRoot === null) {
      throw Error("Expected mainnet to have a static genesis validators root");
    }

    const genesisValidatorsRoot = await getGenesisValidatorsRoot({
      beaconNodes: ["http://127.0.0.1:1"],
      network: "mainnet",
      preset: defaultChainConfig.PRESET_BASE,
    });

    expect(genesisValidatorsRoot).toEqual(fromHex(mainnetGenesisValidatorsRoot));
  });

  describe("without a cached genesis validators root", () => {
    let server: FastifyInstance;
    let baseUrl: string;

    beforeAll(async () => {
      const api = {
        beacon: {
          async getGenesis() {
            const genesis = ssz.phase0.Genesis.defaultValue();
            genesis.genesisValidatorsRoot = fromHex(
              "0x1111111111111111111111111111111111111111111111111111111111111111"
            );
            return {data: genesis};
          },
        },
        config: {
          async getSpec() {
            return {data: {}};
          },
        },
      } as DeepPartial<BeaconApiMethods>;

      const testServer = getTestServer();
      server = testServer.server;
      registerRoutes(server, createChainForkConfig(defaultChainConfig), api as BeaconApiMethods, ["beacon", "config"]);
      baseUrl = await testServer.start();
    });

    afterAll(async () => {
      if (server !== undefined) {
        await server.close();
      }
    });

    it("fetches genesis validators root from the beacon api", async () => {
      const genesisValidatorsRoot = await getGenesisValidatorsRoot({
        beaconNodes: [baseUrl],
        preset: defaultChainConfig.PRESET_BASE,
      });

      expect(genesisValidatorsRoot).toEqual(
        fromHex("0x1111111111111111111111111111111111111111111111111111111111111111")
      );
    });

    it("falls back to zero root with force when fetching genesis fails", async () => {
      const genesisValidatorsRoot = await getGenesisValidatorsRoot({
        beaconNodes: ["http://127.0.0.1:1"],
        force: true,
        preset: defaultChainConfig.PRESET_BASE,
      });

      expect(Array.from(genesisValidatorsRoot)).toEqual(Array(32).fill(0));
    });
  });
});
