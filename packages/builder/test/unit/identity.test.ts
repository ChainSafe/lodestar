import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {PAYLOAD_BUILDER_VERSION} from "@lodestar/params";
import {ErrorAborted, FetchError, TimeoutError, toHex} from "@lodestar/utils";
import {WAITING_FOR_BUILDER_POLL_MS, getBuilderStatus, resolveBuilderIdentity} from "../../src/identity.js";
import {getApiClientStub, mockApiErrorResponse, mockApiResponse} from "./utils/apiStub.js";
import {ClockMock} from "./utils/clock.js";
import {getMockedLogger} from "./utils/logger.js";
import {mockGetStateBuildersResponse} from "./utils/mocks.js";

describe("Identity", () => {
  const logger = getMockedLogger();
  const clock = new ClockMock();
  const api = getApiClientStub();
  const index = 1;
  const status = "active";
  const pubkey = Buffer.alloc(48, 1);
  const pubkeyString = toHex(pubkey);
  const balance = 1;
  const version = PAYLOAD_BUILDER_VERSION;
  // ClockMock reports currentEpoch=0, use GLOAS_FORK_EPOCH=0 so tests query the beacon node without waiting for the fork
  const config = createChainForkConfig({GLOAS_FORK_EPOCH: 0});

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

  it("returns an inert result and preserves API error detail when status lookup fails", async () => {
    api.beacon.getStateBuilders.mockResolvedValue(await mockApiErrorResponse(500));
    const res = await getBuilderStatus(api, logger, index);
    expect(res).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      "Couldn't fetch the builder",
      {},
      expect.objectContaining({status: 500, message: expect.stringMatching(/status 500/)})
    );
  });

  it("distinguishes an empty successful status response from a beacon node failure", async () => {
    api.beacon.getStateBuilders.mockResolvedValue(
      mockApiResponse({data: [], meta: {executionOptimistic: true, finalized: false}})
    );

    await expect(getBuilderStatus(api, logger, index)).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith("Builder status not available in beacon node");
    expect(logger.warn).not.toHaveBeenCalledWith("Couldn't fetch the builder", expect.anything(), expect.anything());
  });

  it("returns a non-active status without conflating it with a lookup failure", async () => {
    api.beacon.getStateBuilders.mockResolvedValue(
      mockGetStateBuildersResponse(index, {status: "pending", pubkey, balance, version})
    );

    await expect(getBuilderStatus(api, logger, index)).resolves.toEqual({status: "pending", balance});
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("successfully resolves builder identity", async () => {
    api.beacon.getStateBuilders.mockResolvedValue(
      mockGetStateBuildersResponse(index, {status, pubkey, balance, version})
    );

    const builderIndex = await resolveBuilderIdentity(api, logger, pubkeyString, abortController.signal, clock, config);
    expect(builderIndex).toEqual(index);
  });

  it("throws on version mismatch", async () => {
    const newVersion = version + 1;
    api.beacon.getStateBuilders.mockResolvedValue(
      mockGetStateBuildersResponse(index, {status, pubkey, balance, version: newVersion})
    );
    await expect(
      resolveBuilderIdentity(api, logger, pubkeyString, abortController.signal, clock, config)
    ).rejects.toThrow(`Builder version mismatch: got ${newVersion}, expected ${version}`);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledWith(expect.objectContaining({builderIds: [pubkeyString]}));
  });

  it("throws on pubkey mismatch", async () => {
    const invalidPubkey = Buffer.alloc(48, 2);
    api.beacon.getStateBuilders.mockResolvedValue(mockGetStateBuildersResponse(index, {pubkey: invalidPubkey}));
    await expect(
      resolveBuilderIdentity(api, logger, pubkeyString, abortController.signal, clock, config)
    ).rejects.toThrow(`Pubkey mismatch: got=${toHex(invalidPubkey)} expected=${pubkeyString}`);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledWith(expect.objectContaining({builderIds: [pubkeyString]}));
  });

  it("throws on builder status exited", async () => {
    api.beacon.getStateBuilders.mockResolvedValue(mockGetStateBuildersResponse(index, {status: "exited", pubkey}));
    await expect(
      resolveBuilderIdentity(api, logger, pubkeyString, abortController.signal, clock, config)
    ).rejects.toThrow(`Builder exited: id=${pubkeyString}`);
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
    const promise = resolveBuilderIdentity(api, logger, pubkeyString, abortController.signal, clock, config);
    await vi.advanceTimersByTimeAsync(WAITING_FOR_BUILDER_POLL_MS);
    expect(await promise).toEqual(index);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledTimes(2);
  });

  it("aborts while waiting for the beacon node to return the builder", async () => {
    vi.useFakeTimers();
    api.beacon.getStateBuilders.mockResolvedValue(
      mockApiResponse({data: [], meta: {executionOptimistic: true, finalized: false}})
    );

    const promise = resolveBuilderIdentity(api, logger, pubkeyString, abortController.signal, clock, config);
    await vi.advanceTimersByTimeAsync(0);
    abortController.abort();

    await expect(promise).rejects.toThrow(ErrorAborted);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for a pending builder to become active", async () => {
    vi.useFakeTimers();
    api.beacon.getStateBuilders.mockResolvedValueOnce(
      mockGetStateBuildersResponse(index, {status: "pending", pubkey, balance, version})
    );
    api.beacon.getStateBuilders.mockResolvedValue(
      mockGetStateBuildersResponse(index, {status, pubkey, balance, version})
    );
    const promise = resolveBuilderIdentity(api, logger, pubkeyString, abortController.signal, clock, config);
    await vi.advanceTimersByTimeAsync(WAITING_FOR_BUILDER_POLL_MS);
    expect(await promise).toEqual(index);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledTimes(2);
  });

  it("waits for the Gloas fork before querying the beacon node", async () => {
    vi.useFakeTimers();
    // ClockMock reports currentEpoch=0, so a future fork epoch keeps the builder in the pre-fork wait loop
    const futureForkConfig = createChainForkConfig({GLOAS_FORK_EPOCH: 1});
    const promise = resolveBuilderIdentity(api, logger, pubkeyString, abortController.signal, clock, futureForkConfig);
    await vi.advanceTimersByTimeAsync(WAITING_FOR_BUILDER_POLL_MS);

    expect(api.beacon.getStateBuilders).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "Waiting for Gloas fork before resolving builder identity",
      expect.objectContaining({gloasForkEpoch: 1, currentEpoch: 0})
    );

    abortController.abort();
    await expect(promise).rejects.toThrow(ErrorAborted);
  });

  it("keeps polling on a transient pre-gloas 400 at the fork boundary", async () => {
    vi.useFakeTimers();
    api.beacon.getStateBuilders.mockResolvedValueOnce(await mockApiErrorResponse(400));
    api.beacon.getStateBuilders.mockResolvedValue(
      mockGetStateBuildersResponse(index, {status, pubkey, balance, version})
    );
    const promise = resolveBuilderIdentity(api, logger, pubkeyString, abortController.signal, clock, config);
    await vi.advanceTimersByTimeAsync(WAITING_FOR_BUILDER_POLL_MS);
    expect(await promise).toEqual(index);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledTimes(2);
  });

  it("resolves once the Gloas fork is reached", async () => {
    vi.useFakeTimers();
    const forkClock = new ClockMock();
    const forkConfig = createChainForkConfig({GLOAS_FORK_EPOCH: 1});
    api.beacon.getStateBuilders.mockResolvedValue(
      mockGetStateBuildersResponse(index, {status, pubkey, balance, version})
    );
    const promise = resolveBuilderIdentity(api, logger, pubkeyString, abortController.signal, forkClock, forkConfig);

    // Pre-fork: the builder waits without querying the beacon node
    await vi.advanceTimersByTimeAsync(WAITING_FOR_BUILDER_POLL_MS);
    expect(api.beacon.getStateBuilders).not.toHaveBeenCalled();

    // Gloas fork reached: the builder queries the beacon node and resolves
    forkClock.currentEpoch = 1;
    await vi.advanceTimersByTimeAsync(WAITING_FOR_BUILDER_POLL_MS);
    expect(await promise).toEqual(index);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledTimes(1);
  });

  it("rejects without querying the beacon node when the signal is already aborted", async () => {
    const abortSignal = AbortSignal.abort();
    await expect(resolveBuilderIdentity(api, logger, pubkeyString, abortSignal, clock, config)).rejects.toThrow(
      ErrorAborted
    );
    expect(api.beacon.getStateBuilders).not.toHaveBeenCalled();
  });

  it("throws on beacon node 500", async () => {
    const resStatus = 500;
    api.beacon.getStateBuilders.mockResolvedValue(await mockApiErrorResponse(resStatus));
    await expect(
      resolveBuilderIdentity(api, logger, pubkeyString, abortController.signal, clock, config)
    ).rejects.toThrow(/status 500/);
  });

  it("keeps polling on getStateBuilders request timeout", async () => {
    vi.useFakeTimers();
    api.beacon.getStateBuilders.mockRejectedValueOnce(new TimeoutError("getStateBuilders request"));
    api.beacon.getStateBuilders.mockResolvedValue(
      mockGetStateBuildersResponse(index, {status, pubkey, balance, version})
    );
    const promise = resolveBuilderIdentity(api, logger, pubkeyString, abortController.signal, clock, config);
    await vi.advanceTimersByTimeAsync(WAITING_FOR_BUILDER_POLL_MS);
    expect(await promise).toEqual(index);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledTimes(2);
  });

  it("keeps polling on fetch failure", async () => {
    vi.useFakeTimers();
    api.beacon.getStateBuilders.mockRejectedValueOnce(
      new FetchError(
        "http://127.0.0.1:9596",
        new TypeError("fetch failed", {
          cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:9596"), {code: "ECONNREFUSED"}),
        })
      )
    );
    api.beacon.getStateBuilders.mockResolvedValue(
      mockGetStateBuildersResponse(index, {status, pubkey, balance, version})
    );
    const promise = resolveBuilderIdentity(api, logger, pubkeyString, abortController.signal, clock, config);
    await vi.advanceTimersByTimeAsync(WAITING_FOR_BUILDER_POLL_MS);
    expect(await promise).toEqual(index);
    expect(api.beacon.getStateBuilders).toHaveBeenCalledTimes(2);
  });

  it("throws on invalid beacon node url / invalid input", async () => {
    api.beacon.getStateBuilders.mockRejectedValue(
      new FetchError(
        "invalid-url",
        new TypeError("Failed to parse URL from invalid-url", {
          cause: Object.assign(new Error("Invalid URL"), {input: "invalid-url", code: "ERR_INVALID_URL"}),
        })
      )
    );
    await expect(
      resolveBuilderIdentity(api, logger, pubkeyString, abortController.signal, clock, config)
    ).rejects.toThrow(/Failed to parse URL/);
  });
});
