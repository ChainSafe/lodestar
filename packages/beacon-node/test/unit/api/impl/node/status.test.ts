import {describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {defer} from "@lodestar/utils";
import {getNodeApi} from "../../../../../src/api/impl/node/index.js";
import {defaultApiOptions} from "../../../../../src/api/options.js";
import {getApiTestModules} from "../../../../utils/api.js";

describe("node sync status APIs", () => {
  const status: routes.node.SyncingStatus = {
    headSlot: 100,
    syncDistance: 0,
    isSyncing: false,
    isOptimistic: false,
    elOffline: false,
  };

  it("waits for sync status before returning the response", async () => {
    const modules = getApiTestModules();
    const pending = defer<routes.node.SyncingStatus>();
    modules.sync.getSyncStatus = vi.fn(() => pending.promise);
    const api = getNodeApi(defaultApiOptions, modules);
    const response = api.getSyncingStatus();
    pending.resolve(status);
    await expect(response).resolves.toEqual({data: status});
  });

  it.each([
    {isSyncing: false, isOptimistic: false, elOffline: false, expected: 200},
    {isSyncing: true, isOptimistic: false, elOffline: false, expected: 206},
    {isSyncing: false, isOptimistic: true, elOffline: false, expected: 206},
    {isSyncing: false, isOptimistic: false, elOffline: true, expected: 206},
  ])("awaits status when deciding health: %j", async ({expected, ...flags}) => {
    const modules = getApiTestModules();
    modules.sync.getSyncStatus = vi.fn().mockResolvedValue({...status, ...flags});
    const api = getNodeApi(defaultApiOptions, modules);
    await expect(api.getHealth({})).resolves.toEqual({status: expected});
  });

  it("preserves the requested syncing status code for an optimistic head", async () => {
    const modules = getApiTestModules();
    modules.sync.getSyncStatus = vi.fn().mockResolvedValue({...status, isOptimistic: true});
    const api = getNodeApi(defaultApiOptions, modules);
    await expect(api.getHealth({syncingStatus: 503})).resolves.toEqual({status: 503});
  });
});
