import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {PAYLOAD_BUILDER_VERSION} from "@lodestar/params";
import {WAITING_FOR_BUILDER_POLL_MS, getBuilderStatus, resolveBuilderIdentity} from "../../src/identity.js";
import {getApiClientStub, mockApiErrorResponse, mockApiResponse} from "./utils/apiStub.js";
import {getMockedLogger} from "./utils/logger.js";
import {mockGetStateBuildersResponse} from "./utils/mocks.js";

describe("Identity", () => {
  const logger = getMockedLogger();
  const api = getApiClientStub();
  const builderIndex = 1;
  const builderStatus = "active";
  const builderPubkey = "0xaabb";
  const builderBalance = 1;
  const builderVersion = PAYLOAD_BUILDER_VERSION;

  let abortController: AbortController;

  beforeEach(() => {
    abortController = new AbortController();
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
  });

  it("successfully gets the builder status", async () => {
    api.beacon.getStateBuilders.mockResolvedValue(
      mockGetStateBuildersResponse(builderIndex, builderStatus, builderBalance, builderVersion)
    );

    const res = await getBuilderStatus(api, logger, builderIndex);
    expect(res).not.toBeNull();
    expect(res?.status).toEqual(builderStatus);
    expect(res?.balance).toEqual(builderBalance);
  });

  it("fails to fetch the builder status", async () => {
    api.beacon.getStateBuilders.mockResolvedValue(await mockApiErrorResponse(500));
    const res = await getBuilderStatus(api, logger, builderIndex);
    expect(res).toBeNull();
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("successfully resolves builder identity", async () => {
    api.beacon.getStateBuilders.mockResolvedValue(
      mockGetStateBuildersResponse(builderIndex, builderStatus, builderBalance, builderVersion)
    );

    const _builderIndex = await resolveBuilderIdentity(api, logger, builderPubkey, abortController.signal);
    expect(_builderIndex).toEqual(builderIndex);
  });

  it("throws on version mismatch", async () => {
    const version = builderVersion + 1;
    api.beacon.getStateBuilders.mockResolvedValue(
      mockGetStateBuildersResponse(builderIndex, builderStatus, builderBalance, version)
    );
    await expect(resolveBuilderIdentity(api, logger, builderPubkey, abortController.signal)).rejects.toThrow(
      `Builder version mismatch: got ${version}, expected ${builderVersion}`
    );
    expect(api.beacon.getStateBuilders).toHaveBeenCalledWith(expect.objectContaining({builderIds: [builderPubkey]}));
  });

  it("throws on builder not active", async () => {
    const inactiveStatus = "exited";
    api.beacon.getStateBuilders.mockResolvedValue(mockGetStateBuildersResponse(builderIndex, inactiveStatus));
    await expect(resolveBuilderIdentity(api, logger, builderPubkey, abortController.signal)).rejects.toThrow(
      `Builder not active: ${inactiveStatus}`
    );
    expect(api.beacon.getStateBuilders).toHaveBeenCalledWith(expect.objectContaining({builderIds: [builderPubkey]}));
  });

  it("waits for beacon node to return the builder", async () => {
    vi.useFakeTimers();
    api.beacon.getStateBuilders.mockResolvedValueOnce(
      mockApiResponse({data: [], meta: {executionOptimistic: true, finalized: false}})
    );
    api.beacon.getStateBuilders.mockResolvedValue(
      mockGetStateBuildersResponse(builderIndex, builderStatus, builderBalance, builderVersion)
    );
    const promise = resolveBuilderIdentity(api, logger, builderPubkey, abortController.signal);
    await vi.advanceTimersByTimeAsync(WAITING_FOR_BUILDER_POLL_MS);
    expect(await promise).toEqual(builderIndex);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledTimes(2);
  });

  it("throws on beacon node 500", async () => {
    const resStatus = 500;
    api.beacon.getStateBuilders.mockResolvedValue(await mockApiErrorResponse(resStatus));
    await expect(resolveBuilderIdentity(api, logger, builderPubkey, abortController.signal)).rejects.toThrow(
      /status 500/
    );
  });
});
