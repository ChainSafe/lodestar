import {afterEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {config} from "@lodestar/config/default";
import {ssz} from "@lodestar/types";
import {BuilderApiClient} from "../../../../src/execution/builder/apiClient.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";

const {getExecutionPayloadBid} = vi.hoisted(() => ({getExecutionPayloadBid: vi.fn()}));

vi.mock("@lodestar/api/builder", () => ({
  getClient: () => ({getExecutionPayloadBid}),
}));

describe("execution/builder/apiClient", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("ignores an entry with an empty url without failing the other entries", async () => {
    const slot = 1;
    const validEntry = getBuilderEntry("https://builder.example.com", slot);
    const signedBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    getExecutionPayloadBid.mockResolvedValue({value: () => signedBid});

    const client = new BuilderApiClient({}, config, null, getMockedLogger());
    const bids = await client.getExecutionPayloadBids(
      [getBuilderEntry("", slot), validEntry],
      slot,
      new Uint8Array(32),
      new Uint8Array(32),
      new Uint8Array(48),
      1_000
    );

    expect(bids).toEqual([{url: "https://builder.example.com", entry: validEntry, signedBid}]);
    expect(getExecutionPayloadBid).toHaveBeenCalledOnce();
  });
});

function getBuilderEntry(url: string, slot: number): routes.validator.BuilderEntry {
  const auth = ssz.gloas.SignedRequestAuth.defaultValue();
  auth.message.data = new Uint8Array([1]);
  auth.message.slot = slot;
  return {
    url: new TextEncoder().encode(url),
    auth,
    builderPubkeys: [],
    maxExecutionPayment: 0n,
    minBid: 0n,
    builderBoostFactor: 100n,
  };
}
