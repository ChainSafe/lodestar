import http from "node:http";
import {AddressInfo} from "node:net";
import {afterEach, describe, expect, it} from "vitest";
import {genesisData} from "@lodestar/config/networks";
import {ssz} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {getGenesisValidatorsRoot} from "../../../src/cmds/validator/slashingProtection/utils.js";

describe("validator / slashingProtection / genesisValidatorsRoot", () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  });

  async function serveGenesis(handler: http.RequestListener): Promise<string> {
    const httpServer = http.createServer(handler);
    server = httpServer;
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  }

  it("uses the static mainnet root without a beacon node", async () => {
    expect(await getGenesisValidatorsRoot({network: "mainnet", preset: "mainnet", beaconNodes: []})).toEqual(
      fromHex("0x4b363db94e286120d76eb905340fdd4e54bfe9f06bf33ff6cf5ad27f511bfe95")
    );
  });

  it("does not advertise a static root for ephemery", () => {
    expect(genesisData.ephemery.genesisValidatorsRoot).toBeNull();
  });

  it.each(["ephemery", undefined] as const)("fetches the live root for network %s", async (network) => {
    const genesis = ssz.phase0.Genesis.defaultValue();
    genesis.genesisValidatorsRoot = new Uint8Array(32).fill(1);
    const baseUrl = await serveGenesis((req, res) => {
      expect(req.url).toBe("/eth/v1/beacon/genesis");
      res.writeHead(200, {"content-type": "application/json"});
      res.end(JSON.stringify({data: ssz.phase0.Genesis.toJson(genesis)}));
    });

    expect(await getGenesisValidatorsRoot({network, preset: "mainnet", beaconNodes: [baseUrl]})).toEqual(
      genesis.genesisValidatorsRoot
    );
  });

  describe.each(["ephemery", undefined] as const)("network %s", (network) => {
    describe.each(["http error", "connection error"])("%s", (failure) => {
      it.each([false, true])("honors force=%s", async (force) => {
        let requests = 0;
        const baseUrl = await serveGenesis((req, res) => {
          requests++;
          if (failure === "connection error") {
            req.socket.destroy();
          } else {
            res.writeHead(503, {"content-type": "application/json"});
            res.end(JSON.stringify({code: 503, message: "Genesis unavailable"}));
          }
        });
        const root = getGenesisValidatorsRoot({network, preset: "mainnet", beaconNodes: [baseUrl], force});
        if (force) {
          expect(Uint8Array.from(await root)).toEqual(new Uint8Array(32));
        } else {
          await expect(root).rejects.toThrow();
        }
        expect(requests).toBeGreaterThan(0);
      });
    });
  });
});
