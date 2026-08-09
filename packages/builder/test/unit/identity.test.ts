import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {getBuilderStatus, resolveBuilderIdentity} from "../../src/identity.js";
import {getApiClientStub, mockApiErrorResponse} from "./utils/apiStub.js";
import {getMockedLogger} from "./utils/logger.js";
import {mockGetStateBuildersResponse} from "./utils/mocks.js";

describe("Identity", () => {
  const logger = getMockedLogger();
  const api = getApiClientStub();
  const builderIndex = 1;
  const builderStatus = "active";
  const builderBalance = 1;

  beforeEach(() => {
    api.beacon.getStateBuilders.mockResolvedValue(
      mockGetStateBuildersResponse(builderIndex, builderStatus, builderBalance)
    );
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("successfully gets the builder status", async () => {
    const res = await getBuilderStatus(api, logger, builderIndex);
    expect(res).not.toBeNull();
    expect(res?.status).toEqual(builderStatus);
    expect(res?.balance).toEqual(builderBalance);
  });

  it("fails to fetch the builder status", async () => {
    api.beacon.getStateBuilders.mockResolvedValue(mockApiErrorResponse(500));
    const res = await getBuilderStatus(api, logger, builderIndex);
    expect(res).toBeNull();
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});
