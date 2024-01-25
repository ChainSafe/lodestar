import {describe, it, expect, beforeEach, vi} from "vitest";
import {ProtoBlock} from "@lodestar/fork-choice";
import {SyncState} from "../../../../../src/sync/interface.js";
import {ApiTestModules, getApiTestModules} from "../../../../utils/api.js";
import {getValidatorApi} from "../../../../../src/api/impl/validator/index.js";

describe("api - validator - produceAttestationData", function () {
  let modules: ApiTestModules;
  let api: ReturnType<typeof getValidatorApi>;

  beforeEach(function () {
    modules = getApiTestModules();
    api = getValidatorApi(modules);
  });

  it("Should throw when node is not synced", async function () {
    // Set the node's state to way back from current slot
    const currentSlot = 100000;
    const headSlot = 0;
    vi.spyOn(modules.chain.clock, "currentSlot", "get").mockReturnValue(currentSlot);
    vi.spyOn(modules.sync, "state", "get").mockReturnValue(SyncState.SyncingFinalized);
    modules.forkChoice.getHead.mockReturnValue({slot: headSlot} as ProtoBlock);

    await expect(api.produceAttestationData(0, 0)).rejects.toThrow("Node is syncing");
  });

  it("Should throw error when node is stopped", async function () {
    const currentSlot = 100000;
    vi.spyOn(modules.chain.clock, "currentSlot", "get").mockReturnValue(currentSlot);
    vi.spyOn(modules.sync, "state", "get").mockReturnValue(SyncState.Stalled);

    // Should not allow any call to validator API
    await expect(api.produceAttestationData(0, 0)).rejects.toThrow("Node is syncing - waiting for peers");
  });
});
