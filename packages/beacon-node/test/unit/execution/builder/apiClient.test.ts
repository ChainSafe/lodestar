import {afterEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {config} from "@lodestar/config/default";
import {ssz} from "@lodestar/types";
import type {IBlsVerifier} from "../../../../src/chain/bls/index.js";
import {BuilderApiClient} from "../../../../src/execution/builder/apiClient.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";

const {getExecutionPayloadBid, submitBuilderPreferences, submitSignedBeaconBlock, verifySignatureSets} = vi.hoisted(
  () => ({
    getExecutionPayloadBid: vi.fn(),
    submitBuilderPreferences: vi.fn(),
    submitSignedBeaconBlock: vi.fn(),
    verifySignatureSets: vi.fn().mockResolvedValue(true),
  })
);

vi.mock("@lodestar/api/builder", () => ({
  getClient: () => ({getExecutionPayloadBid, submitBuilderPreferences, submitSignedBeaconBlock}),
}));

const bls = {
  verifySignatureSets,
  verifySignatureSetsSameMessage: vi.fn(),
  close: vi.fn(),
  canAcceptWork: vi.fn(),
} satisfies IBlsVerifier;

describe("execution/builder/apiClient", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("ignores an entry with an invalid url without failing the other entries", async () => {
    const slot = 1;
    const invalidUrl = "not a url";
    const validEntry = getBuilderEntry("https://builder.example.com", slot);
    const signedBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    getExecutionPayloadBid.mockResolvedValue({value: () => signedBid});

    const logger = getMockedLogger();
    const client = new BuilderApiClient({}, config, bls, null, logger);
    const bids = await client.getExecutionPayloadBids(
      [getBuilderEntry(invalidUrl, slot), validEntry],
      slot,
      new Uint8Array(32),
      new Uint8Array(32),
      new Uint8Array(48),
      1_000
    );

    expect(bids).toEqual([{url: "https://builder.example.com", entry: validEntry, signedBid}]);
    expect(getExecutionPayloadBid).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith("Ignoring builder entry with invalid url", {slot, url: invalidUrl});
  });

  it("ignores signed block submissions to unauthenticated builder urls", async () => {
    const url = "https://builder.example.com";
    const signedBlock = {data: ssz.gloas.SignedBeaconBlock.defaultValue()};
    const logger = getMockedLogger();
    const client = new BuilderApiClient({}, config, bls, null, logger);

    await client.submitSignedBeaconBlock(url, signedBlock);

    expect(submitSignedBeaconBlock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith("Ignoring signed block submission to unauthenticated builder", {url});
  });

  it("submits signed blocks to builders registered through preferences", async () => {
    const url = "https://builder.example.com";
    const proposerPubkey = new Uint8Array(48);
    const preferences = ssz.gloas.BuilderPreferencesRequest.defaultValue();
    const signedBlock = {data: ssz.gloas.SignedBeaconBlock.defaultValue()};
    submitBuilderPreferences.mockResolvedValue({assertOk: vi.fn()});
    submitSignedBeaconBlock.mockResolvedValue({assertOk: vi.fn()});

    const client = new BuilderApiClient({}, config, bls);
    await client.submitBuilderPreferences(url, proposerPubkey, preferences);
    await client.submitSignedBeaconBlock(url, signedBlock);

    expect(verifySignatureSets).toHaveBeenCalledOnce();
    expect(submitSignedBeaconBlock).toHaveBeenCalledWith({signedBlock}, {retries: 2});
  });

  it("does not cache a builder client when request auth is invalid", async () => {
    const slot = 1;
    const entry = getBuilderEntry("https://builder.example.com", slot);
    const proposerPubkey = new Uint8Array(48);
    const signedBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    verifySignatureSets.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    getExecutionPayloadBid.mockResolvedValue({value: () => signedBid});

    const client = new BuilderApiClient({}, config, bls);
    expect(
      await client.getExecutionPayloadBids([entry], slot, new Uint8Array(32), new Uint8Array(32), proposerPubkey, 1_000)
    ).toEqual([]);
    expect(
      await client.getExecutionPayloadBids([entry], slot, new Uint8Array(32), new Uint8Array(32), proposerPubkey, 1_000)
    ).toEqual([{url: "https://builder.example.com", entry, signedBid}]);

    expect(verifySignatureSets).toHaveBeenCalledTimes(2);
    expect(getExecutionPayloadBid).toHaveBeenCalledOnce();
  });
});

function getBuilderEntry(url: string, slot: number): routes.validator.BuilderEntry {
  const auth = ssz.gloas.SignedBuilderRequestAuth.defaultValue();
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
