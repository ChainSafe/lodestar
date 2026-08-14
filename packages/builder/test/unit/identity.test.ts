import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {PAYLOAD_BUILDER_VERSION} from "@lodestar/params";
import {ErrorAborted, toHex} from "@lodestar/utils";
import {WAITING_FOR_BUILDER_POLL_MS, getBuilderStatus, resolveBuilderIdentity} from "../../src/identity.js";
import {getApiClientStub, mockApiErrorResponse, mockApiResponse} from "./utils/apiStub.js";
import {getMockedLogger} from "./utils/logger.js";
import {mockGetStateBuildersResponse} from "./utils/mocks.js";

describe("Identity", () => {
  const logger = getMockedLogger();
  const api = getApiClientStub();
  const index = 1;
  const status = "active";
  const pubkey = Buffer.alloc(48, 1);
  const pubkeyString = toHex(pubkey);
  const balance = 1;
  const version = PAYLOAD_BUILDER_VERSION;

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
      mockGetStateBuildersResponse(index, {status, pubkey, balance, version})
    );

    const res = await getBuilderStatus(api, logger, index);
    expect(res).not.toBeNull();
    expect(res?.status).toEqual(status);
    expect(res?.balance).toEqual(balance);
  });

  it("fails to fetch the builder status", async () => {
    api.beacon.getStateBuilders.mockResolvedValue(await mockApiErrorResponse(500));
    const res = await getBuilderStatus(api, logger, index);
    expect(res).toBeNull();
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("successfully resolves builder identity", async () => {
    api.beacon.getStateBuilders.mockResolvedValue(
      mockGetStateBuildersResponse(index, {status, pubkey, balance, version})
    );

    const builderIndex = await resolveBuilderIdentity(api, logger, pubkeyString, abortController.signal);
    expect(builderIndex).toEqual(index);
  });

  it("throws on version mismatch", async () => {
    const newVersion = version + 1;
    api.beacon.getStateBuilders.mockResolvedValue(
      mockGetStateBuildersResponse(index, {status, pubkey, balance, version: newVersion})
    );
    await expect(resolveBuilderIdentity(api, logger, pubkeyString, abortController.signal)).rejects.toThrow(
      `Builder version mismatch: got ${newVersion}, expected ${version}`
    );
    expect(api.beacon.getStateBuilders).toHaveBeenCalledWith(expect.objectContaining({builderIds: [pubkeyString]}));
  });

  it("throws on pubkey mismatch", async () => {
    const invalidPubkey = Buffer.alloc(48, 2);
    api.beacon.getStateBuilders.mockResolvedValue(mockGetStateBuildersResponse(index, {pubkey: invalidPubkey}));
    await expect(resolveBuilderIdentity(api, logger, pubkeyString, abortController.signal)).rejects.toThrow(
      `Pubkey mismatch: got=${toHex(invalidPubkey)} expected=${pubkeyString}`
    );
    expect(api.beacon.getStateBuilders).toHaveBeenCalledWith(expect.objectContaining({builderIds: [pubkeyString]}));
  });

  it("throws on builder status exited", async () => {
    api.beacon.getStateBuilders.mockResolvedValue(mockGetStateBuildersResponse(index, {status: "exited", pubkey}));
    await expect(resolveBuilderIdentity(api, logger, pubkeyString, abortController.signal)).rejects.toThrow(
      `Builder exited: id=${pubkeyString}`
    );
    expect(api.beacon.getStateBuilders).toHaveBeenCalledWith(expect.objectContaining({builderIds: [pubkeyString]}));
  });

  it("waits for beacon node to return the builder", async () => {
    vi.useFakeTimers();
    api.beacon.getStateBuilders.mockResolvedValueOnce(
      mockApiResponse({data: [], meta: {executionOptimistic: true, finalized: false}})
    );
    api.beacon.getStateBuilders.mockResolvedValue(
      mockGetStateBuildersResponse(index, {status, pubkey, balance, version})
    );
    const promise = resolveBuilderIdentity(api, logger, pubkeyString, abortController.signal);
    await vi.advanceTimersByTimeAsync(WAITING_FOR_BUILDER_POLL_MS);
    expect(await promise).toEqual(index);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledTimes(2);
  });

  it("waits for a pending builder to become active", async () => {
    vi.useFakeTimers();
    api.beacon.getStateBuilders.mockResolvedValueOnce(
      mockGetStateBuildersResponse(index, {status: "pending", pubkey, balance, version})
    );
    api.beacon.getStateBuilders.mockResolvedValue(
      mockGetStateBuildersResponse(index, {status, pubkey, balance, version})
    );
    const promise = resolveBuilderIdentity(api, logger, pubkeyString, abortController.signal);
    await vi.advanceTimersByTimeAsync(WAITING_FOR_BUILDER_POLL_MS);
    expect(await promise).toEqual(index);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledTimes(2);
  });

  it("rejects without querying the beacon node when the signal is already aborted", async () => {
    const abortSignal = AbortSignal.abort();
    await expect(resolveBuilderIdentity(api, logger, pubkeyString, abortSignal)).rejects.toThrow(ErrorAborted);
    expect(api.beacon.getStateBuilders).not.toHaveBeenCalled();
  });

  it("throws on beacon node 500", async () => {
    const resStatus = 500;
    api.beacon.getStateBuilders.mockResolvedValue(await mockApiErrorResponse(resStatus));
    await expect(resolveBuilderIdentity(api, logger, pubkeyString, abortController.signal)).rejects.toThrow(
      /status 500/
    );
  });
});
