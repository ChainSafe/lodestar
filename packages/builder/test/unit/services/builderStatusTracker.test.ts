import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {ssz} from "@lodestar/types";
import {BuilderStatusTracker} from "../../../src/services/builderStatusTracker.js";
import {getApiClientStub, mockApiErrorResponse, mockApiResponse} from "../utils/apiStub.js";
import {getMockedLogger} from "../utils/logger.js";

describe("BuilderStatusTracker", () => {
  const logger = getMockedLogger();
  const api = getApiClientStub();
  const builderIndex = 1;

  let builderStatusTracker: BuilderStatusTracker;

  function getMockedApiResponse(
    status: routes.beacon.BuilderStatus = "active",
    balance = 1
  ): Awaited<ReturnType<typeof api.beacon.getStateBuilders>> {
    const builder = ssz.gloas.Builder.defaultValue();
    builder.balance = balance;
    return mockApiResponse({
      data: [{index: builderIndex, status, builder}],
      meta: {executionOptimistic: true, finalized: false},
    });
  }

  beforeEach(() => {
    builderStatusTracker = new BuilderStatusTracker(api, logger, builderIndex);
    api.beacon.getStateBuilders.mockResolvedValue(getMockedApiResponse());
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
    await builderStatusTracker.poll();
    const {status, balance} = builderStatusTracker.getStatus();
    expect(status).toEqual("active");
    expect(balance).toEqual(1);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledOnce();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("updates balance across polls", async () => {
    await builderStatusTracker.poll();
    const {status, balance} = builderStatusTracker.getStatus();
    expect(status).toEqual("active");
    expect(balance).toEqual(1);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledOnce();

    api.beacon.getStateBuilders.mockResolvedValue(getMockedApiResponse("active", 2));
    await builderStatusTracker.poll();
    const {status: newStatus, balance: newBalance} = builderStatusTracker.getStatus();
    expect(newStatus).toEqual("active");
    expect(newBalance).toEqual(2);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledTimes(2);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("warns on status change", async () => {
    await builderStatusTracker.poll();
    const {status, balance} = builderStatusTracker.getStatus();
    expect(status).toEqual("active");
    expect(balance).toEqual(1);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledOnce();

    api.beacon.getStateBuilders.mockResolvedValue(getMockedApiResponse("exited", 1));
    await builderStatusTracker.poll();
    const {status: newStatus, balance: newBalance} = builderStatusTracker.getStatus();
    expect(newStatus).toEqual("exited");
    expect(newBalance).toEqual(1);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith("Builder status changed", {from: "active", to: "exited"});
  });

  it("dismisses beacon api 500", async () => {
    await builderStatusTracker.poll();
    const {status, balance} = builderStatusTracker.getStatus();
    expect(status).toEqual("active");
    expect(balance).toEqual(1);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledOnce();

    api.beacon.getStateBuilders.mockResolvedValue(mockApiErrorResponse(500));
    // poll should resolve when beacon node throws 500
    await builderStatusTracker.poll();
    const {status: newStatus, balance: newBalance} = builderStatusTracker.getStatus();
    expect(newStatus).toEqual("active");
    expect(newBalance).toEqual(1);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledTimes(2);
  });
});
