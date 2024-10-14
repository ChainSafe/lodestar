import {describe, it, expect, vi, beforeEach, afterEach, MockedFunction} from "vitest";
import {getApiClientStub, mockApiResponse} from "../../utils/apiStub.js";
import {getMockedLogger} from "../../utils/logger.js";
import {ClockMock} from "../../utils/clock.js";
import {SyncingStatus, SyncingStatusTracker} from "../../../src/services/syncingStatusTracker.js";

describe("SyncingStatusTracker", () => {
  const api = getApiClientStub();
  const logger = getMockedLogger();

  let controller: AbortController;
  let clock: ClockMock;
  let syncingStatusTracker: SyncingStatusTracker;
  let callOnResynced: MockedFunction<() => Promise<void>>;

  beforeEach(() => {
    controller = new AbortController();
    clock = new ClockMock();
    syncingStatusTracker = new SyncingStatusTracker(logger, api, clock, null);
    callOnResynced = vi.fn().mockResolvedValue(undefined);
    syncingStatusTracker.runOnResynced(callOnResynced);
  });

  afterEach(() => {
    vi.resetAllMocks();
    controller.abort();
  });

  it("should handle transition from syncing to synced", async () => {
    // Node is syncing
    const syncing: SyncingStatus = {
      headSlot: 0,
      syncDistance: 1,
      isSyncing: true,
      isOptimistic: false,
      elOffline: false,
    };
    api.node.getSyncingStatus.mockResolvedValue(mockApiResponse({data: syncing}));

    await clock.tickSlotFns(1, controller.signal);

    expect(logger.warn).toHaveBeenCalledWith("Node is syncing", {slot: 1, headSlot: 0, syncDistance: 1});
    expect(logger.verbose).toHaveBeenCalledWith("Node syncing status", {
      slot: 1,
      headSlot: 0,
      syncDistance: 1,
      isSyncing: true,
      isOptimistic: false,
      elOffline: false,
    });
    expect(syncingStatusTracker["prevSyncingStatus"]).toBe(syncing);

    // Transition to synced
    const synced: SyncingStatus = {
      headSlot: 2,
      syncDistance: 0,
      isSyncing: false,
      isOptimistic: false,
      elOffline: false,
    };
    api.node.getSyncingStatus.mockResolvedValue(mockApiResponse({data: synced}));

    await clock.tickSlotFns(2, controller.signal);

    expect(logger.info).toHaveBeenCalledWith("Node is synced", {
      slot: 2,
      headSlot: 2,
      isOptimistic: false,
      elOffline: false,
    });
    expect(logger.verbose).toHaveBeenCalledWith("Node syncing status", {
      slot: 2,
      headSlot: 2,
      syncDistance: 0,
      isSyncing: false,
      isOptimistic: false,
      elOffline: false,
    });
    expect(syncingStatusTracker["prevSyncingStatus"]).toBe(synced);
    expect(callOnResynced).toHaveBeenCalledOnce();
  });

  it("should handle errors when checking syncing status", async () => {
    // Node is offline
    const error = new Error("ECONNREFUSED");
    api.node.getSyncingStatus.mockRejectedValue(error);

    await clock.tickSlotFns(1, controller.signal);

    expect(logger.error).toHaveBeenCalledWith("Failed to check syncing status", {slot: 1}, error);
    expect(syncingStatusTracker["prevSyncingStatus"]).toBe(error);
    expect(callOnResynced).not.toHaveBeenCalled();
  });

  it("should not call scheduled tasks if already synced", async () => {
    // Node is already synced
    const syncedHead1: SyncingStatus = {
      headSlot: 1,
      syncDistance: 0,
      isSyncing: false,
      isOptimistic: false,
      elOffline: false,
    };
    api.node.getSyncingStatus.mockResolvedValue(mockApiResponse({data: syncedHead1}));

    await clock.tickSlotFns(1, controller.signal);

    expect(logger.info).toHaveBeenCalledWith("Node is synced", {
      slot: 1,
      headSlot: 1,
      isOptimistic: false,
      elOffline: false,
    });
    expect(logger.verbose).toHaveBeenCalledWith("Node syncing status", {
      slot: 1,
      headSlot: 1,
      syncDistance: 0,
      isSyncing: false,
      isOptimistic: false,
      elOffline: false,
    });
    expect(syncingStatusTracker["prevSyncingStatus"]).toBe(syncedHead1);

    // Still synced on next tick
    const syncedHead2: SyncingStatus = {
      headSlot: 2,
      syncDistance: 0,
      isSyncing: false,
      isOptimistic: false,
      elOffline: false,
    };
    api.node.getSyncingStatus.mockResolvedValue(mockApiResponse({data: syncedHead2}));

    await clock.tickSlotFns(2, controller.signal);

    // info log should only be printed out once, not every slot
    expect(logger.info).toHaveBeenCalledOnce();
    expect(logger.verbose).toHaveBeenCalledWith("Node syncing status", {
      slot: 2,
      headSlot: 2,
      syncDistance: 0,
      isSyncing: false,
      isOptimistic: false,
      elOffline: false,
    });
    expect(syncingStatusTracker["prevSyncingStatus"]).toBe(syncedHead2);
    expect(callOnResynced).not.toHaveBeenCalled();
  });
});
