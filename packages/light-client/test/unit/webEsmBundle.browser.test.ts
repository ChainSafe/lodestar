/* eslint-disable @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access*/
import {expect, describe, it, vi, beforeAll} from "vitest";
import {sleep} from "@lodestar/utils";
import {Lightclient, LightclientEvent, utils, transport} from "../../dist/lightclient.min.mjs";

describe("web bundle for lightclient", () => {
  vi.setConfig({testTimeout: 20_000});

  // Sometimes bundle takes some time to load in the browser
  beforeAll(async () => {
    await sleep(2000);
  });

  it("should have a global interface", () => {
    expect((window as any)["lodestar"]["lightclient"]).toBeDefined();
  });

  it("should have all relevant exports", () => {
    const lightclient = (window as any)["lodestar"]["lightclient"];
    expect(lightclient).toHaveProperty("Lightclient");
    expect(lightclient).toHaveProperty("LightclientEvent");
    expect(lightclient).toHaveProperty("RunStatusCode");
    expect(lightclient).toHaveProperty("upgradeLightClientFinalityUpdate");
    expect(lightclient).toHaveProperty("upgradeLightClientOptimisticUpdate");
    expect(lightclient).toHaveProperty("utils");
    expect(lightclient).toHaveProperty("transport");
    expect(lightclient).toHaveProperty("validation");

    expect(lightclient.Lightclient).toBeTypeOf("function");
  });

  it("should start the lightclient and sync", async () => {
    const logger = utils.getConsoleLogger({logDebug: true});
    const config = utils.getChainForkConfigFromNetwork("mainnet");

    // TODO: Decide to check which node to use in testing
    // We have one node in CI, but that only starts with e2e tests
    const api = utils.getApiFromUrl("https://lodestar-mainnet.chainsafe.io", "mainnet");

    const lc = await Lightclient.initializeFromCheckpointRoot({
      config,
      logger,
      transport: new transport.LightClientRestTransport(api),
      genesisData: await utils.getGenesisData(api),
      checkpointRoot: await utils.getFinalizedSyncCheckpoint(api),
      opts: {
        allowForcedUpdates: true,
        updateHeadersOnForcedUpdate: true,
      },
    });

    await expect(lc.start()).resolves.toBeUndefined();

    await expect(
      new Promise((resolve) => {
        lc.emitter.on(LightclientEvent.lightClientOptimisticHeader, async (optimisticUpdate: unknown) => {
          resolve(optimisticUpdate);
        });
      })
    ).resolves.toBeDefined();
  });
});
