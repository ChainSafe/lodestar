/* eslint-disable @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-call */
import {expect, describe, it, beforeEach, vi} from "vitest";
import "../../dist/lightclient.min.mjs";

describe("web bundle for lightclient", () => {
  vi.setConfig({testTimeout: 10_000});

  let lightclient: any;

  beforeEach(() => {
    lightclient = (window as any)["lodestar"]["lightclient"];
  });

  it("should have a global interface", () => {
    expect(lightclient).toBeDefined();
  });

  it("should have all relevant exports", () => {
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
    const {Lightclient, LightclientEvent, transport, utils} = lightclient;

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
