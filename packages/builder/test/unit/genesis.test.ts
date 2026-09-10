import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ErrorAborted} from "@lodestar/utils";
import {waitForGenesis} from "../../src/genesis.js";
import {getApiClientStub, mockApiErrorResponse, mockApiResponse} from "./utils/apiStub.js";
import {getMockedLogger} from "./utils/logger.js";

describe("Genesis", () => {
  const logger = getMockedLogger();
  const api = getApiClientStub();
  const genesis = {
    genesisTime: 1,
    genesisValidatorsRoot: new Uint8Array(32),
    genesisForkVersion: new Uint8Array(4),
  };

  let controller: AbortController;

  beforeEach(() => {
    controller = new AbortController();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
  });

  it("waits for a not-found genesis response without logging a stack trace", async () => {
    api.beacon.getGenesis
      .mockResolvedValueOnce(await mockApiErrorResponse(404))
      .mockResolvedValueOnce(mockApiResponse({data: genesis}));

    const promise = waitForGenesis(api, logger, controller.signal);
    await vi.advanceTimersToNextTimerAsync();

    await expect(promise).resolves.toEqual(genesis);
    expect(api.beacon.getGenesis).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith(
      "Waiting for genesis",
      expect.objectContaining({message: expect.any(String)})
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("warns without a stack trace and retries an unexpected genesis failure", async () => {
    const error = Error("genesis endpoint unavailable");
    api.beacon.getGenesis.mockRejectedValueOnce(error).mockResolvedValueOnce(mockApiResponse({data: genesis}));

    const promise = waitForGenesis(api, logger, controller.signal);
    await vi.advanceTimersToNextTimerAsync();

    await expect(promise).resolves.toEqual(genesis);
    expect(api.beacon.getGenesis).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith("Failed to fetch genesis", {message: error.message});
  });

  it("aborts while sleeping between genesis polls", async () => {
    api.beacon.getGenesis.mockResolvedValue(await mockApiErrorResponse(404));

    const promise = waitForGenesis(api, logger, controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();

    await expect(promise).rejects.toThrow(ErrorAborted);
    expect(api.beacon.getGenesis).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
