import {beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ssz} from "@lodestar/types";
import {GloasExecutionBuilder} from "../../../../src/execution/builder/gloas.js";

const mockClient = vi.hoisted(() => ({
  submitBuilderPreferences: vi.fn(),
  getExecutionPayloadBid: vi.fn(),
  submitSignedBeaconBlock: vi.fn(),
}));

vi.mock("@lodestar/api/builder", () => ({
  getClient: () => mockClient,
}));

describe("GloasExecutionBuilder", () => {
  const config = createChainForkConfig(defaultChainConfig);
  const builderUrl = "https://builder.example.com";
  const pubkey = Buffer.alloc(48, 1);
  const root = new Uint8Array(32).fill(1);
  const slot = 10;

  const request = ssz.gloas.BuilderPreferencesRequestV1.defaultValue();
  request.auth.message.data = Buffer.from(builderUrl, "utf8");
  request.auth.message.slot = slot;
  request.preferences.maxExecutionPayment = BigInt(100);

  let executionBuilder: GloasExecutionBuilder;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.submitBuilderPreferences.mockResolvedValue({assertOk: () => {}});
    mockClient.getExecutionPayloadBid.mockResolvedValue({value: () => undefined});
    mockClient.submitSignedBeaconBlock.mockResolvedValue({assertOk: () => {}});

    executionBuilder = new GloasExecutionBuilder({}, config, null);
  });

  it("should cache builder entry and forward preferences", async () => {
    await executionBuilder.submitBuilderPreferences(pubkey, request);

    expect(mockClient.submitBuilderPreferences).toHaveBeenCalledOnce();
    expect(executionBuilder.hasRegisteredBuilders(slot, pubkey)).toBe(true);
    expect(executionBuilder.hasRegisteredBuilders(slot + 1, pubkey)).toBe(false);
    expect(executionBuilder.hasRegisteredBuilders(slot, Buffer.alloc(48, 2))).toBe(false);
  });

  it("should reject preferences with invalid builder url", async () => {
    const invalidRequest = ssz.gloas.BuilderPreferencesRequestV1.defaultValue();
    invalidRequest.auth.message.data = Buffer.from("not a url", "utf8");

    await expect(executionBuilder.submitBuilderPreferences(pubkey, invalidRequest)).rejects.toThrow(
      /Invalid builder url/
    );
  });

  it("should reject preferences for past slots", async () => {
    executionBuilder.prune(slot + 1);

    await expect(executionBuilder.submitBuilderPreferences(pubkey, request)).rejects.toThrow(/past slot/);
  });

  it("should fan out bid requests to registered builders", async () => {
    await executionBuilder.submitBuilderPreferences(pubkey, request);

    const signedBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    mockClient.getExecutionPayloadBid.mockResolvedValue({value: () => signedBid});

    const bids = await executionBuilder.getExecutionPayloadBids(slot, root, root, pubkey);

    expect(mockClient.getExecutionPayloadBid).toHaveBeenCalledOnce();
    expect(mockClient.getExecutionPayloadBid).toHaveBeenCalledWith(
      {slot, parentHash: root, parentRoot: root, proposerPubkey: pubkey, requestAuth: request.auth},
      expect.any(Object)
    );
    expect(bids).toEqual([{url: builderUrl, maxExecutionPayment: BigInt(100), signedBid}]);
  });

  it("should filter out empty bid responses", async () => {
    await executionBuilder.submitBuilderPreferences(pubkey, request);

    expect(await executionBuilder.getExecutionPayloadBids(slot, root, root, pubkey)).toEqual([]);
  });

  it("should filter out failed bid requests", async () => {
    await executionBuilder.submitBuilderPreferences(pubkey, request);
    mockClient.getExecutionPayloadBid.mockRejectedValue(Error("builder unavailable"));

    expect(await executionBuilder.getExecutionPayloadBids(slot, root, root, pubkey)).toEqual([]);
  });

  it("should not request bids if no builders are registered", async () => {
    expect(await executionBuilder.getExecutionPayloadBids(slot, root, root, pubkey)).toEqual([]);
    expect(mockClient.getExecutionPayloadBid).not.toHaveBeenCalled();
  });

  it("should track bid source until pruned", () => {
    const bidSource = {url: builderUrl, bidBlockHash: "0x1234"};
    executionBuilder.recordBidSource(slot, bidSource);

    expect(executionBuilder.getBidSource(slot)).toEqual(bidSource);

    executionBuilder.prune(slot + 1);
    expect(executionBuilder.getBidSource(slot)).toBeUndefined();
  });

  it("should prune registered builders for past slots", async () => {
    await executionBuilder.submitBuilderPreferences(pubkey, request);
    executionBuilder.prune(slot + 1);

    expect(executionBuilder.hasRegisteredBuilders(slot, pubkey)).toBe(false);
  });
});
