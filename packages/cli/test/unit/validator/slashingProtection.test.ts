import http from "node:http";
import {AddressInfo} from "node:net";
import {afterEach, describe, expect, it} from "vitest";
import {ssz} from "@lodestar/types";
import {getGenesisValidatorsRoot} from "../../../src/cmds/validator/slashingProtection/utils.js";

describe("validator / slashingProtection / getGenesisValidatorsRoot", () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  async function serve(handler: http.RequestListener): Promise<string> {
    const httpServer = http.createServer(handler);
    server = httpServer;
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  }

  it("fetches the genesis validators root from the beacon node on ephemery", async () => {
    const genesis = ssz.phase0.Genesis.defaultValue();
    genesis.genesisValidatorsRoot = new Uint8Array(32).fill(1);
    const baseUrl = await serve((_req, res) => {
      res.writeHead(200, {"content-type": "application/json"});
      res.end(JSON.stringify({data: ssz.phase0.Genesis.toJson(genesis)}));
    });

    expect(await getGenesisValidatorsRoot({network: "ephemery", preset: "mainnet", beaconNodes: [baseUrl]})).toEqual(
      genesis.genesisValidatorsRoot
    );
  });

  it("returns a zero root with force if the beacon node connection fails", async () => {
    const baseUrl = await serve((req) => req.socket.destroy());

    const root = await getGenesisValidatorsRoot({
      network: "ephemery",
      preset: "mainnet",
      beaconNodes: [baseUrl],
      force: true,
    });
    expect(Uint8Array.from(root)).toEqual(new Uint8Array(32));
  });
});
