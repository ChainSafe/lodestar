import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {ErrorAborted} from "@lodestar/utils";
import {logNodeVersion, waitForNodeReady} from "../../src/readiness.js";
import {getApiClientStub, mockApiErrorResponse, mockApiResponse} from "./utils/apiStub.js";
import {getMockedLogger} from "./utils/logger.js";

describe("Readiness", () => {
  const logger = getMockedLogger();
  const api = getApiClientStub();

  let controller: AbortController;

  beforeEach(() => {
    controller = new AbortController();
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
  });

  function mockSyncingStatus(overrides: Partial<routes.node.SyncingStatus> = {}) {
    return mockApiResponse<routes.node.SyncingStatus, void, routes.node.Endpoints["getSyncingStatus"]>({
      data: {
        headSlot: 1,
        syncDistance: 0,
        isSyncing: false,
        isOptimistic: false,
        elOffline: false,
        ...overrides,
      },
    });
  }

  it("waits for a syncing beacon node to become ready", async () => {
    vi.useFakeTimers();
    api.node.getSyncingStatus
      .mockResolvedValueOnce(mockSyncingStatus({headSlot: 0, syncDistance: 1, isSyncing: true}))
      .mockResolvedValueOnce(mockSyncingStatus());

    const promise = waitForNodeReady(api, logger, controller.signal);
    await vi.advanceTimersToNextTimerAsync();

    await expect(promise).resolves.toBeUndefined();
    expect(api.node.getSyncingStatus).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith(
      "Beacon node is not ready yet",
      expect.objectContaining({headSlot: 0, syncDistance: 1, elOffline: false})
    );
    expect(logger.info).toHaveBeenCalledWith("Beacon node is ready", {headSlot: 1});
  });

  it("waits for an offline execution client to become ready", async () => {
    vi.useFakeTimers();
    api.node.getSyncingStatus
      .mockResolvedValueOnce(mockSyncingStatus({elOffline: true}))
      .mockResolvedValueOnce(mockSyncingStatus());

    const promise = waitForNodeReady(api, logger, controller.signal);
    await vi.advanceTimersToNextTimerAsync();

    await expect(promise).resolves.toBeUndefined();
    expect(api.node.getSyncingStatus).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith(
      "Beacon node EL is offline, unable to submit bids",
      expect.objectContaining({elOffline: true})
    );
  });

  it("retries a non-ok sync response and then becomes ready", async () => {
    vi.useFakeTimers();
    api.node.getSyncingStatus
      .mockResolvedValueOnce(await mockApiErrorResponse(500))
      .mockResolvedValueOnce(mockSyncingStatus());

    const promise = waitForNodeReady(api, logger, controller.signal);
    await vi.advanceTimersToNextTimerAsync();

    await expect(promise).resolves.toBeUndefined();
    expect(api.node.getSyncingStatus).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith("Cannot get node sync status", expect.objectContaining({status: 500}));
  });

  it("retries an unreachable beacon node and then becomes ready", async () => {
    vi.useFakeTimers();
    const error = Error("connect ECONNREFUSED");
    api.node.getSyncingStatus.mockRejectedValueOnce(error).mockResolvedValueOnce(mockSyncingStatus());

    const promise = waitForNodeReady(api, logger, controller.signal);
    await vi.advanceTimersToNextTimerAsync();

    await expect(promise).resolves.toBeUndefined();
    expect(api.node.getSyncingStatus).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith("Cannot reach the beacon node", {}, error);
  });

  it("aborts while sleeping between readiness polls", async () => {
    vi.useFakeTimers();
    api.node.getSyncingStatus.mockResolvedValue(mockSyncingStatus({isSyncing: true}));

    const promise = waitForNodeReady(api, logger, controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();

    await expect(promise).rejects.toThrow(ErrorAborted);
    expect(api.node.getSyncingStatus).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits while the beacon node head is optimistic", async () => {
    vi.useFakeTimers();
    api.node.getSyncingStatus
      .mockResolvedValueOnce(mockSyncingStatus({isOptimistic: true}))
      .mockResolvedValueOnce(mockSyncingStatus());

    const promise = waitForNodeReady(api, logger, controller.signal);
    await vi.advanceTimersToNextTimerAsync();

    await expect(promise).resolves.toBeUndefined();
    expect(api.node.getSyncingStatus).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      "Beacon node head is optimistic, execution payloads are not yet verified - unable to submit bids",
      expect.objectContaining({headSlot: 1, syncDistance: 0})
    );
  });

  it("keeps node-version lookup failure non-fatal", async () => {
    const error = Error("version endpoint unavailable");
    api.node.getNodeVersionV2.mockRejectedValue(error);

    await expect(logNodeVersion(api, logger)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith("Failed to get node version", {}, error);
  });
});
