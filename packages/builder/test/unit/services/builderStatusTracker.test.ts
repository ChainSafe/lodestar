import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {BuilderStatusTracker} from "../../../src/services/builderStatusTracker.js";
import {getApiClientStub, mockApiErrorResponse} from "../utils/apiStub.js";
import {getMockedLogger} from "../utils/logger.js";
import {mockGetStateBuildersResponse} from "../utils/mocks.js";

describe("BuilderStatusTracker", () => {
  const logger = getMockedLogger();
  const api = getApiClientStub();
  const builderIndex = 1;
  const epoch = 1;
  const metrics = null;

  let builderStatusTracker: BuilderStatusTracker;

  beforeEach(() => {
    builderStatusTracker = new BuilderStatusTracker(api, logger, builderIndex, metrics);
    api.beacon.getStateBuilders.mockResolvedValue(mockGetStateBuildersResponse(builderIndex));
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("status and balance should initially be undefined", async () => {
    const {status, balance} = builderStatusTracker.getStatus();
    expect(status).toBeUndefined();
    expect(balance).toBeUndefined();
  });

  it("status and balance should give real values after polling", async () => {
    await builderStatusTracker.poll(epoch);
    const {status, balance} = builderStatusTracker.getStatus();
    expect(status).toEqual("active");
    expect(balance).toEqual(1);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledOnce();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("updates balance across polls", async () => {
    await builderStatusTracker.poll(epoch);
    const {status, balance} = builderStatusTracker.getStatus();
    expect(status).toEqual("active");
    expect(balance).toEqual(1);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledOnce();

    api.beacon.getStateBuilders.mockResolvedValue(
      mockGetStateBuildersResponse(builderIndex, {status: "active", balance: 2})
    );
    await builderStatusTracker.poll(epoch);
    const {status: newStatus, balance: newBalance} = builderStatusTracker.getStatus();
    expect(newStatus).toEqual("active");
    expect(newBalance).toEqual(2);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledTimes(2);
    expect(logger.info).not.toHaveBeenCalledWith("Builder status changed", expect.anything());
  });

  it("logs on status change", async () => {
    await builderStatusTracker.poll(epoch);
    const {status, balance} = builderStatusTracker.getStatus();
    expect(status).toEqual("active");
    expect(balance).toEqual(1);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledOnce();

    api.beacon.getStateBuilders.mockResolvedValue(
      mockGetStateBuildersResponse(builderIndex, {status: "exited", balance: 1})
    );
    await builderStatusTracker.poll(epoch);
    const {status: newStatus, balance: newBalance} = builderStatusTracker.getStatus();
    expect(newStatus).toEqual("exited");
    expect(newBalance).toEqual(1);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith("Builder status changed", {from: "active", to: "exited", epoch: 1});
  });

  it("confirms an assumed identity by pubkey and keeps tracking", async () => {
    const pubkey = "0x" + "11".repeat(48);
    const tracker = new BuilderStatusTracker(api, logger, 0, metrics, {status: "active", balance: 10}, pubkey);
    api.beacon.getStateBuilders.mockResolvedValue(
      mockGetStateBuildersResponse(0, {status: "active", balance: 9, pubkey: Buffer.alloc(48, 0x11)})
    );
    await tracker.poll(epoch);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledWith(expect.objectContaining({builderIds: [pubkey]}));
    expect(tracker.getStatus()).toEqual({status: "active", balance: 9});
    expect(logger.info).toHaveBeenCalledWith("Assumed builder identity confirmed by the beacon node", {
      index: 0,
      epoch,
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("stops bidding when the registry assigns the pubkey another index than assumed", async () => {
    const pubkey = "0x" + "11".repeat(48);
    const tracker = new BuilderStatusTracker(api, logger, 0, metrics, {status: "active", balance: 10}, pubkey);
    api.beacon.getStateBuilders.mockResolvedValue(
      mockGetStateBuildersResponse(1, {status: "active", balance: 10, pubkey: Buffer.alloc(48, 0x11)})
    );
    await tracker.poll(epoch);
    expect(tracker.getStatus()).toEqual({status: undefined, balance: undefined});
    expect(logger.error).toHaveBeenCalledWith("Builder index differs from the assumed one, not bidding", {
      assumed: 0,
      actual: 1,
      epoch,
    });
    await tracker.poll(epoch);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledOnce();
  });

  it("preserves the assumption while head is pre-fork, then uses the registry status and balance", async () => {
    const pubkey = "0x" + "11".repeat(48);
    const tracker = new BuilderStatusTracker(
      api,
      logger,
      0,
      metrics,
      {status: "active", balance: 10_000_000_000},
      pubkey
    );
    api.beacon.getStateBuilders.mockResolvedValueOnce(await mockApiErrorResponse(400));
    await tracker.poll(epoch);
    expect(tracker.getStatus()).toEqual({status: "active", balance: 10_000_000_000});

    api.beacon.getStateBuilders.mockResolvedValue(
      mockGetStateBuildersResponse(0, {status: "pending", balance: 9_000_000_000, pubkey: Buffer.alloc(48, 0x11)})
    );
    await tracker.poll(epoch + 1);
    expect(tracker.getStatus()).toEqual({status: "pending", balance: 9_000_000_000});
  });

  it("dismisses beacon api 500", async () => {
    await builderStatusTracker.poll(epoch);
    const {status, balance} = builderStatusTracker.getStatus();
    expect(status).toEqual("active");
    expect(balance).toEqual(1);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledOnce();

    api.beacon.getStateBuilders.mockResolvedValue(await mockApiErrorResponse(500));
    // poll should resolve when beacon node throws 500
    await builderStatusTracker.poll(epoch);
    const {status: newStatus, balance: newBalance} = builderStatusTracker.getStatus();
    expect(newStatus).toEqual("active");
    expect(newBalance).toEqual(1);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledTimes(2);
  });
});
