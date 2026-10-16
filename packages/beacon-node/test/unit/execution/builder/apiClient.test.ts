import {afterEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {config} from "@lodestar/config/default";
import {ssz} from "@lodestar/types";
import type {IBlsVerifier} from "../../../../src/chain/bls/index.js";
import {BuilderApiClient, getBidRounds} from "../../../../src/execution/builder/apiClient.js";
import {IClock} from "../../../../src/util/clock.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";

const {getExecutionPayloadBid, submitBuilderPreferences, submitSignedBeaconBlock, status, verifySignatureSets} =
  vi.hoisted(() => ({
    getExecutionPayloadBid: vi.fn(),
    submitBuilderPreferences: vi.fn(),
    submitSignedBeaconBlock: vi.fn(),
    status: vi.fn(),
    verifySignatureSets: vi.fn().mockResolvedValue(true),
  }));

vi.mock("@lodestar/api/builder", () => ({
  getClient: () => ({getExecutionPayloadBid, submitBuilderPreferences, submitSignedBeaconBlock, status}),
}));

const bls = {
  verifySignatureSets,
  verifySignatureSetsSameMessage: vi.fn(),
  close: vi.fn(),
  canAcceptWork: vi.fn(),
} satisfies IBlsVerifier;
const clock = {msFromSlot: () => 250} as unknown as IClock;

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
    const client = new BuilderApiClient({}, config, clock, bls, null, logger);
    const bids = await client.getExecutionPayloadBids(
      [getBuilderEntry(invalidUrl, slot), validEntry],
      slot,
      new Uint8Array(32),
      new Uint8Array(32),
      new Uint8Array(48)
    );

    expect(bids).toEqual([
      {url: "https://builder.example.com", entry: validEntry, signedBid, receivedMs: expect.any(Number)},
    ]);
    expect(getExecutionPayloadBid).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith("Ignoring builder entry with invalid url", {slot, url: invalidUrl});
  });

  it("advertises the configured bid deadline and allows for event loop lag", async () => {
    const slot = 1;
    const entry = getBuilderEntry("https://builder.example.com", slot);
    getExecutionPayloadBid.mockResolvedValue({value: () => ssz.gloas.SignedExecutionPayloadBid.defaultValue()});

    const client = new BuilderApiClient({bidDeadline: 800}, config, clock, bls);
    await client.getExecutionPayloadBids([entry], slot, new Uint8Array(32), new Uint8Array(32), new Uint8Array(48));

    expect(getExecutionPayloadBid).toHaveBeenCalledWith(expect.objectContaining({timeoutMs: 800}), {timeoutMs: 1050});
  });

  it("requests bids once per round and collects every distinct bid", async () => {
    const slot = 1;
    const entry = getBuilderEntry("https://builder.example.com", slot);
    for (const value of [1, 3, 2]) {
      const signedBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
      signedBid.message.value = value;
      signedBid.signature = Buffer.alloc(96, value);
      getExecutionPayloadBid.mockResolvedValueOnce({value: () => signedBid});
    }

    const client = new BuilderApiClient({bidDeadline: 10, bidRequests: 3}, config, clock, bls);
    const bids = await client.getExecutionPayloadBids(
      [entry],
      slot,
      new Uint8Array(32),
      new Uint8Array(32),
      new Uint8Array(48)
    );

    expect(getExecutionPayloadBid).toHaveBeenCalledTimes(3);
    expect(bids.map((bid) => bid.signedBid.message.value)).toEqual([1, 3, 2]);
  });

  it("collects a bid returned unchanged by a later round only once", async () => {
    const slot = 1;
    const entry = getBuilderEntry("https://builder.example.com", slot);
    getExecutionPayloadBid.mockResolvedValue({value: () => ssz.gloas.SignedExecutionPayloadBid.defaultValue()});

    const client = new BuilderApiClient({bidDeadline: 10, bidRequests: 2}, config, clock, bls);
    const bids = await client.getExecutionPayloadBids(
      [entry],
      slot,
      new Uint8Array(32),
      new Uint8Array(32),
      new Uint8Array(48)
    );

    expect(getExecutionPayloadBid).toHaveBeenCalledTimes(2);
    expect(bids).toHaveLength(1);
  });

  it("skips the remaining rounds once aborted", async () => {
    const slot = 1;
    const entry = getBuilderEntry("https://builder.example.com", slot);
    const controller = new AbortController();
    getExecutionPayloadBid.mockImplementationOnce(async () => {
      controller.abort();
      return {value: () => undefined};
    });

    const client = new BuilderApiClient({bidDeadline: 10, bidRequests: 3}, config, clock, bls);
    const bids = await client.getExecutionPayloadBids(
      [entry],
      slot,
      new Uint8Array(32),
      new Uint8Array(32),
      new Uint8Array(48),
      controller.signal
    );

    expect(getExecutionPayloadBid).toHaveBeenCalledOnce();
    expect(bids).toHaveLength(0);
  });

  it("returns the bids collected so far once aborted while a later round is in flight", async () => {
    const slot = 1;
    const entry = getBuilderEntry("https://builder.example.com", slot);
    const controller = new AbortController();
    getExecutionPayloadBid
      .mockResolvedValueOnce({value: () => ssz.gloas.SignedExecutionPayloadBid.defaultValue()})
      .mockImplementationOnce(() => {
        controller.abort();
        return new Promise(() => {});
      });

    const client = new BuilderApiClient({bidDeadline: 10, bidRequests: 2}, config, clock, bls);
    const bids = await client.getExecutionPayloadBids(
      [entry],
      slot,
      new Uint8Array(32),
      new Uint8Array(32),
      new Uint8Array(48),
      controller.signal
    );

    expect(getExecutionPayloadBid).toHaveBeenCalledTimes(2);
    expect(bids).toHaveLength(1);
  });

  it("awaits the requests in flight when aborted without a bid", async () => {
    const slot = 1;
    const entry = getBuilderEntry("https://builder.example.com", slot);
    const controller = new AbortController();
    getExecutionPayloadBid.mockImplementationOnce(async () => {
      controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {value: () => ssz.gloas.SignedExecutionPayloadBid.defaultValue()};
    });

    const client = new BuilderApiClient({bidDeadline: 10}, config, clock, bls);
    const bids = await client.getExecutionPayloadBids(
      [entry],
      slot,
      new Uint8Array(32),
      new Uint8Array(32),
      new Uint8Array(48),
      controller.signal
    );

    expect(bids).toHaveLength(1);
  });

  it("ignores builder urls that cannot be safely returned in the response header", async () => {
    const slot = 1;
    const invalidUtf8Entry = getBuilderEntry("https://builder.example.com", slot);
    invalidUtf8Entry.url = new Uint8Array([0xff]);
    const nonAsciiEntry = getBuilderEntry("https://builder.example.com/é", slot);
    const validEntry = getBuilderEntry("https://builder.example.com", slot);
    const signedBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    getExecutionPayloadBid.mockResolvedValue({value: () => signedBid});

    const client = new BuilderApiClient({}, config, clock, bls);
    const bids = await client.getExecutionPayloadBids(
      [invalidUtf8Entry, nonAsciiEntry, validEntry],
      slot,
      new Uint8Array(32),
      new Uint8Array(32),
      new Uint8Array(48)
    );

    expect(bids).toEqual([
      {url: "https://builder.example.com", entry: validEntry, signedBid, receivedMs: expect.any(Number)},
    ]);
    expect(getExecutionPayloadBid).toHaveBeenCalledOnce();
  });

  it("ignores signed block submissions to unauthenticated builder urls", async () => {
    const url = "https://builder.example.com";
    const signedBlock = {data: ssz.gloas.SignedBeaconBlock.defaultValue()};
    const logger = getMockedLogger();
    const client = new BuilderApiClient({}, config, clock, bls, null, logger);

    await client.submitSignedBeaconBlock(url, signedBlock);

    expect(submitSignedBeaconBlock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith("Ignoring signed block submission to unauthenticated builder", {url});
  });

  it("submits signed blocks to builders registered through preferences", async () => {
    const url = "https://builder.example.com";
    const proposerPubkey = new Uint8Array(48);
    const preferences = ssz.gloas.BuilderPreferencesRequest.defaultValue();
    preferences.auth.message.data = new Uint8Array([1]);
    const signedBlock = {data: ssz.gloas.SignedBeaconBlock.defaultValue()};
    submitBuilderPreferences.mockResolvedValue({assertOk: vi.fn()});
    submitSignedBeaconBlock.mockResolvedValue({assertOk: vi.fn()});

    const client = new BuilderApiClient({}, config, clock, bls);
    await client.submitBuilderPreferences(url, proposerPubkey, preferences);
    await client.submitSignedBeaconBlock(url, signedBlock);

    expect(verifySignatureSets).toHaveBeenCalledOnce();
    expect(submitSignedBeaconBlock).toHaveBeenCalledWith({signedBlock}, {redirect: "manual"});
  });

  it("rejects empty request auth data even when the builder client is cached", async () => {
    const slot = 1;
    const url = "https://builder.example.com";
    const proposerPubkey = new Uint8Array(48);
    const preferences = ssz.gloas.BuilderPreferencesRequest.defaultValue();
    preferences.auth.message.data = new Uint8Array([1]);
    preferences.auth.message.slot = slot;
    submitBuilderPreferences.mockResolvedValue({assertOk: vi.fn()});

    const entry = getBuilderEntry(url, slot);
    entry.auth.message.data = new Uint8Array();

    const client = new BuilderApiClient({}, config, clock, bls);
    await client.submitBuilderPreferences(url, proposerPubkey, preferences);
    const bids = await client.getExecutionPayloadBids(
      [entry],
      slot,
      new Uint8Array(32),
      new Uint8Array(32),
      proposerPubkey
    );

    expect(bids).toEqual([]);
    expect(verifySignatureSets).toHaveBeenCalledOnce();
    expect(getExecutionPayloadBid).not.toHaveBeenCalled();
  });

  it("does not cache a builder client when request auth is invalid", async () => {
    const slot = 1;
    const entry = getBuilderEntry("https://builder.example.com", slot);
    const proposerPubkey = new Uint8Array(48);
    const signedBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    verifySignatureSets.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    getExecutionPayloadBid.mockResolvedValue({value: () => signedBid});

    const client = new BuilderApiClient({}, config, clock, bls);
    expect(
      await client.getExecutionPayloadBids([entry], slot, new Uint8Array(32), new Uint8Array(32), proposerPubkey)
    ).toEqual([]);
    expect(
      await client.getExecutionPayloadBids([entry], slot, new Uint8Array(32), new Uint8Array(32), proposerPubkey)
    ).toEqual([{url: "https://builder.example.com", entry, signedBid, receivedMs: expect.any(Number)}]);

    expect(verifySignatureSets).toHaveBeenCalledTimes(2);
    expect(getExecutionPayloadBid).toHaveBeenCalledOnce();
  });

  it("returns bids in arrival order", async () => {
    const slot = 1;
    const entryA = getBuilderEntry("https://builder-a.example.com", slot);
    const entryB = getBuilderEntry("https://builder-b.example.com", slot);
    const slowBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    slowBid.message.builderIndex = 0;
    const fastBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    fastBid.message.builderIndex = 1;

    // The first entry responds after the second one
    getExecutionPayloadBid
      .mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve({value: () => slowBid}), 20)))
      .mockImplementationOnce(async () => ({value: () => fastBid}));

    const client = new BuilderApiClient({}, config, clock, bls);
    const bids = await client.getExecutionPayloadBids(
      [entryA, entryB],
      slot,
      new Uint8Array(32),
      new Uint8Array(32),
      new Uint8Array(48)
    );

    expect(bids.map((bid) => bid.signedBid.message.builderIndex)).toEqual([1, 0]);
  });

  it("logs a debug line for each builder that is ready", async () => {
    const url = "https://builder.example.com";
    const {client, logger} = await getClientWithBuilder(url);
    status.mockResolvedValue({assertOk: () => {}});

    await client.checkStatus();

    expect(status).toHaveBeenCalledOnce();
    expect(logger.debug).toHaveBeenCalledWith("Builder is ready", {builder: url});
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("warns when a builder fails its status check without throwing", async () => {
    const url = "https://builder.example.com";
    const {client, logger} = await getClientWithBuilder(url);
    status.mockRejectedValue(new Error("builder is down"));

    await expect(client.checkStatus()).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith("Builder status check failed", {builder: url}, expect.any(Error));
    expect(logger.debug).not.toHaveBeenCalledWith("Builder is ready", {builder: url});
  });
});

/** A client with one builder already dialed, so there is something to check the status of */
async function getClientWithBuilder(url: string) {
  const logger = getMockedLogger();
  const client = new BuilderApiClient({}, config, clock, bls, null, logger);

  getExecutionPayloadBid.mockResolvedValue({value: () => undefined});
  await client.getExecutionPayloadBids(
    [getBuilderEntry(url, 1)],
    1,
    new Uint8Array(32),
    new Uint8Array(32),
    new Uint8Array(48)
  );
  vi.clearAllMocks();
  return {client, logger};
}

describe("execution/builder/apiClient - getBidRounds", () => {
  const testCases: {id: string; msFromSlot: number; delay: number; deadline: number; n: number; want: number[][]}[] = [
    {id: "single request at the request time", msFromSlot: 100, delay: 0, deadline: 500, n: 1, want: [[100, 600]]},
    {
      id: "delayed rounds on time",
      msFromSlot: 50,
      delay: 500,
      deadline: 600,
      n: 3,
      want: [
        [500, 1100],
        [1100, 1700],
        [1700, 2300],
      ],
    },
    {
      id: "late request compresses the rounds",
      msFromSlot: 1200,
      delay: 500,
      deadline: 600,
      n: 3,
      want: [
        [1200, 1800],
        [1800, 2400],
        [2400, 3000],
      ],
    },
    {
      id: "request after the delay starts right away",
      msFromSlot: 700,
      delay: 500,
      deadline: 500,
      n: 2,
      want: [
        [700, 1200],
        [1200, 1700],
      ],
    },
  ];

  for (const {id, msFromSlot, delay, deadline, n, want} of testCases) {
    it(id, () => {
      expect(
        getBidRounds(msFromSlot, delay, deadline, n).map(({startMs, deadlineMs}) => [startMs, deadlineMs])
      ).toEqual(want);
    });
  }
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
