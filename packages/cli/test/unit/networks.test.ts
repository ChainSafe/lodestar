import http from "node:http";
import {AddressInfo} from "node:net";
import {afterEach, describe, expect, it} from "vitest";
import {ENR} from "@chainsafe/enr";
import {config} from "@lodestar/config/default";
import {
  fetchWeakSubjectivityStateBytes,
  getGenesisFileUrl,
  getGenesisStateRoot,
  getNetworkData,
  isKnownNetworkName,
} from "../../src/networks/index.js";
import {testLogger} from "../utils.js";

describe("plataberget network", () => {
  it("is a known network with genesis and bootnode data", () => {
    expect(isKnownNetworkName("plataberget")).toBe(true);
    expect(getGenesisFileUrl("plataberget")).toBe(
      "https://raw.githubusercontent.com/ethpandaops/glamsterdam-devnets/master/network-configs/devnet-8/metadata/genesis.ssz"
    );
    expect(getGenesisStateRoot("plataberget")).toBe(
      "0x328f399d20b80bb5cdc1f325ccc160bae63d81c8fa9b23fcf8c1795f40d8df9d"
    );

    const {bootEnrs, bootnodesFileUrl} = getNetworkData("plataberget");
    expect(bootnodesFileUrl).toBe(
      "https://raw.githubusercontent.com/ethpandaops/glamsterdam-devnets/master/network-configs/devnet-8/metadata/bootstrap_nodes.yaml"
    );
    expect(bootEnrs).toHaveLength(20);
    for (const enr of bootEnrs) {
      expect(() => ENR.decodeTxt(enr)).not.toThrow();
    }
  });
});

describe("fetchWeakSubjectivityStateBytes", () => {
  let server: http.Server | null = null;

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = null;
  });

  async function serveState(headers: Record<string, string>): Promise<string> {
    const httpServer = http.createServer((_req, res) => {
      res.writeHead(200, {"content-type": "application/octet-stream", ...headers});
      res.end(new Uint8Array(48));
    });
    server = httpServer;
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  }

  it("returns state bytes if Eth-Consensus-Version header is set", async () => {
    const checkpointSyncUrl = await serveState({"eth-consensus-version": "phase0"});
    const {stateBytes} = await fetchWeakSubjectivityStateBytes(config, testLogger(), {checkpointSyncUrl});
    expect(stateBytes.length).toBe(48);
  });

  it("rejects response without Eth-Consensus-Version header", async () => {
    const checkpointSyncUrl = await serveState({});
    await expect(fetchWeakSubjectivityStateBytes(config, testLogger(), {checkpointSyncUrl})).rejects.toThrow(
      "Eth-Consensus-Version header is required in response"
    );
  });

  it("rejects state whose fork does not match local config", async () => {
    const checkpointSyncUrl = await serveState({"eth-consensus-version": "electra"});
    await expect(fetchWeakSubjectivityStateBytes(config, testLogger(), {checkpointSyncUrl})).rejects.toThrow(
      "Checkpoint sync server returned electra state at slot 0 but local config expects phase0"
    );
  });
});
