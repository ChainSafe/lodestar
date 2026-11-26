import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {BuilderStatusTracker} from "../../../src/services/builderStatusTracker.js";
import {getApiClientStub, mockApiErrorResponse} from "../utils/apiStub.js";
import {getMockedLogger} from "../utils/logger.js";
import {mockGetStateBuildersResponse, mockPendingPayments} from "../utils/mocks.js";

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
    mockPendingPayments(api);
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

  it("sums the pending payments and pending withdrawals of the builder", async () => {
    mockPendingPayments(api, {
      payments: [
        [builderIndex, 3],
        [builderIndex + 1, 100],
        [builderIndex, 4],
      ],
      withdrawals: [
        [builderIndex + 1, 100],
        [builderIndex, 5],
      ],
    });

    const pendingPayments = await builderStatusTracker.poll(epoch);

    expect(pendingPayments?.slice(0, 3).map(({withdrawal}) => withdrawal.amount)).toEqual([3, 100, 4]);

    expect(builderStatusTracker.getStatus()).toEqual({status: "active", balance: 1, pendingPaymentsGwei: 12});
  });

  it("reads builder, pending payments and pending withdrawals from the same state", async () => {
    const stateId = "0x" + "ab".repeat(32);

    await builderStatusTracker.poll(epoch, stateId);

    expect(api.beacon.getBuilderPendingPayments).toHaveBeenCalledExactlyOnceWith({stateId});
    expect(api.beacon.getBuilderPendingWithdrawals).toHaveBeenCalledExactlyOnceWith({stateId});
    expect(api.beacon.getStateBuilders).toHaveBeenCalledExactlyOnceWith({stateId, builderIds: [builderIndex]});
  });

  it("reads the pending payments before the balance they are debited from", async () => {
    await builderStatusTracker.poll(epoch);

    const [payments] = api.beacon.getBuilderPendingPayments.mock.invocationCallOrder;
    const [withdrawals] = api.beacon.getBuilderPendingWithdrawals.mock.invocationCallOrder;
    const [builders] = api.beacon.getStateBuilders.mock.invocationCallOrder;
    expect(payments).toBeLessThan(withdrawals);
    expect(withdrawals).toBeLessThan(builders);
  });

  it("keeps balance and pending payments of the last poll if pending payments are not available", async () => {
    mockPendingPayments(api, {payments: [[builderIndex, 3]]});
    await builderStatusTracker.poll(epoch);

    api.beacon.getStateBuilders.mockResolvedValue(
      mockGetStateBuildersResponse(builderIndex, {status: "exited", balance: 2})
    );
    api.beacon.getBuilderPendingWithdrawals.mockResolvedValue(await mockApiErrorResponse(500));

    await expect(builderStatusTracker.poll(epoch)).resolves.toBeNull();

    expect(builderStatusTracker.getStatus()).toEqual({status: "exited", balance: 1, pendingPaymentsGwei: 3});
    expect(logger.warn).toHaveBeenCalledWith("Couldn't fetch the builder pending payments", {}, expect.any(Error));
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
