import {afterEach, describe, expect, it, vi} from "vitest";
import {PAYLOAD_BUILDER_VERSION} from "@lodestar/params";
import {getBuilderStatus, resolveBuilderIdentity} from "../../src/identity.js";
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

  afterEach(() => {
    vi.resetAllMocks();
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
    api.beacon.getStateBuilders.mockResolvedValue(mockApiErrorResponse(500));
    const res = await getBuilderStatus(api, logger, builderIndex);
    expect(res).toBeNull();
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("successfully resolves builder identity", async () => {
    api.beacon.getStateBuilders.mockResolvedValue(
      mockGetStateBuildersResponse(builderIndex, builderStatus, builderBalance, builderVersion)
    );

    const _builderIndex = await resolveBuilderIdentity(api, logger, builderPubkey);
    expect(_builderIndex).toEqual(builderIndex);
  });

  it("throws on version mismatch", async () => {
    const version = builderVersion + 1;
    api.beacon.getStateBuilders.mockResolvedValue(
      mockGetStateBuildersResponse(builderIndex, builderStatus, builderBalance, version)
    );
    await expect(resolveBuilderIdentity(api, logger, builderPubkey)).rejects.toThrow(
      `Builder version mismatch: got ${version}, expected ${builderVersion}`
    );
    expect(api.beacon.getStateBuilders).toHaveBeenCalledWith(expect.objectContaining({builderIds: [builderPubkey]}));
  });

  it("throws on builder not active", async () => {
    const inactiveStatus = "exited";
    api.beacon.getStateBuilders.mockResolvedValue(mockGetStateBuildersResponse(builderIndex, inactiveStatus));
    await expect(resolveBuilderIdentity(api, logger, builderPubkey)).rejects.toThrow(
      `Builder not active: ${inactiveStatus}`
    );
    expect(api.beacon.getStateBuilders).toHaveBeenCalledWith(expect.objectContaining({builderIds: [builderPubkey]}));
  });

  it("throws on builder not known", async () => {
    api.beacon.getStateBuilders.mockResolvedValue(
      mockApiResponse({data: [], meta: {executionOptimistic: true, finalized: false}})
    );
    await expect(resolveBuilderIdentity(api, logger, builderPubkey)).rejects.toThrow(
      `Builder not known to the beacon node: ${builderPubkey}`
    );
  });

  it("throws on beacon node 500", async () => {
    const resStatus = 500;
    api.beacon.getStateBuilders.mockResolvedValue(mockApiErrorResponse(resStatus));
    await expect(resolveBuilderIdentity(api, logger, builderPubkey)).rejects.toThrow(
      `Failed to get builder state from beacon node: ${resStatus}`
    );
  });
});
