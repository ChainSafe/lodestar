import {describe, it, expect, beforeEach, vi} from "vitest";
import {config} from "@lodestar/config/default";
import {ProtoBlock} from "@lodestar/fork-choice";
import {SyncState} from "../../../../../src/sync/interface.js";
import {ApiModules} from "../../../../../src/api/impl/types.js";
import {getValidatorApi} from "../../../../../src/api/impl/validator/index.js";
import {testLogger} from "../../../../utils/logger.js";
import {ApiImplTestModules, setupApiImplTestServer} from "../../../../__mocks__/apiMocks.js";

describe("api - validator - produceAttestationData", function () {
  const logger = testLogger();
  let syncStub: ApiImplTestModules["syncStub"];
  let modules: ApiModules;
  let server: ApiImplTestModules;

  beforeEach(function () {
    server = setupApiImplTestServer();
    syncStub = server.syncStub;
    modules = {
      chain: server.chainStub,
      config,
      db: server.dbStub,
      logger,
      network: server.networkStub,
      sync: syncStub,
      metrics: null,
    };
  });

  it("Should throw when node is not synced", async function () {
    // Set the node's state to way back from current slot
    const currentSlot = 100000;
    const headSlot = 0;
    vi.spyOn(server.chainStub.clock, "currentSlot", "get").mockReturnValue(currentSlot);
    vi.spyOn(syncStub, "state", "get").mockReturnValue(SyncState.SyncingFinalized);
    server.chainStub.forkChoice.getHead.mockReturnValue({slot: headSlot} as ProtoBlock);

    // Should not allow any call to validator API
    const api = getValidatorApi(modules);
    await expect(api.produceAttestationData(0, 0)).rejects.toThrow("Node is syncing");
  });

  it("Should throw error when node is stopped", async function () {
    const currentSlot = 100000;
    vi.spyOn(server.chainStub.clock, "currentSlot", "get").mockReturnValue(currentSlot);
    vi.spyOn(syncStub, "state", "get").mockReturnValue(SyncState.Stalled);
    server.chainStub.forkChoice.getHead.mockReturnValue({slot: currentSlot} as ProtoBlock);

    // Should not allow any call to validator API
    const api = getValidatorApi(modules);
    await expect(api.produceAttestationData(0, 0)).rejects.toThrow("Node is syncing - waiting for peers");
  });
});
