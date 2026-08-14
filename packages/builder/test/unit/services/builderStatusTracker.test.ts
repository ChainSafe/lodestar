import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {BuilderStatusTracker} from "../../../src/services/builderStatusTracker.js";
import {getApiClientStub, mockApiErrorResponse} from "../utils/apiStub.js";
import {getMockedLogger} from "../utils/logger.js";
import {mockGetStateBuildersResponse} from "../utils/mocks.js";

describe("BuilderStatusTracker", () => {
  const logger = getMockedLogger();
  const api = getApiClientStub();
  const builderIndex = 1;
  const slot = 1;

  let builderStatusTracker: BuilderStatusTracker;

  beforeEach(() => {
    builderStatusTracker = new BuilderStatusTracker(api, logger, builderIndex);
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
    await builderStatusTracker.poll(slot);
    const {status, balance} = builderStatusTracker.getStatus();
    expect(status).toEqual("active");
    expect(balance).toEqual(1);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledOnce();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("updates balance across polls", async () => {
    await builderStatusTracker.poll(slot);
    const {status, balance} = builderStatusTracker.getStatus();
    expect(status).toEqual("active");
    expect(balance).toEqual(1);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledOnce();

    api.beacon.getStateBuilders.mockResolvedValue(
      mockGetStateBuildersResponse(builderIndex, {status: "active", balance: 2})
    );
    await builderStatusTracker.poll(slot);
    const {status: newStatus, balance: newBalance} = builderStatusTracker.getStatus();
    expect(newStatus).toEqual("active");
    expect(newBalance).toEqual(2);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledTimes(2);
    expect(logger.info).not.toHaveBeenCalledWith("Builder status changed", expect.anything());
  });

  it("logs on status change", async () => {
    await builderStatusTracker.poll(slot);
    const {status, balance} = builderStatusTracker.getStatus();
    expect(status).toEqual("active");
    expect(balance).toEqual(1);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledOnce();

    api.beacon.getStateBuilders.mockResolvedValue(
      mockGetStateBuildersResponse(builderIndex, {status: "exited", balance: 1})
    );
    await builderStatusTracker.poll(slot);
    const {status: newStatus, balance: newBalance} = builderStatusTracker.getStatus();
    expect(newStatus).toEqual("exited");
    expect(newBalance).toEqual(1);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith("Builder status changed", {from: "active", to: "exited", slot: 1});
  });

  it("dismisses beacon api 500", async () => {
    await builderStatusTracker.poll(slot);
    const {status, balance} = builderStatusTracker.getStatus();
    expect(status).toEqual("active");
    expect(balance).toEqual(1);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledOnce();

    api.beacon.getStateBuilders.mockResolvedValue(await mockApiErrorResponse(500));
    // poll should resolve when beacon node throws 500
    await builderStatusTracker.poll(slot);
    const {status: newStatus, balance: newBalance} = builderStatusTracker.getStatus();
    expect(newStatus).toEqual("active");
    expect(newBalance).toEqual(1);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledTimes(2);
  });
});
