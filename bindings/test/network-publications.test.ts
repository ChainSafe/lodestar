import {setTimeout as delay} from "node:timers/promises";
import {expect, test} from "vitest";
import {applicationConfig, holdSettling, localIntent, startRuntime, topicName} from "./utils/network.js";

const BLOCK = topicName();
const SYNC = topicName("sync_committee_0");
const REQUEST = "/eth2/beacon_chain/req/beacon_blocks_by_root/2/ssz_snappy";

test("request capacity refusal is typed while control and publication admission remain available", async () => {
  const config = applicationConfig();
  config.resources.bridgeBudgetBytes = 256 * 1024 * 1024;
  const runtime = startRuntime(config);
  try {
    await runtime.applyIntent(localIntent(config));
    const streams: ReturnType<typeof runtime.request>[] = [];
    expect(() => {
      for (let i = 0; i < 1024; i++) streams.push(runtime.request(runtime.identity.peerId, REQUEST, new Uint8Array(0)));
    }).toThrow(
      expect.objectContaining({
        capacityToken: expect.any(String),
        code: "NetworkRequestRejected",
        reason: "local_capacity",
      })
    );
    await Promise.all([
      runtime.reStatusPeers([]),
      runtime.publishGossip(BLOCK, new Uint8Array(4000), {allowZeroPeers: true}),
      ...streams.map((stream) => expect(stream.next()).rejects.toMatchObject({reason: "disconnected"})),
    ]);
  } finally {
    await runtime.close();
  }
});

test("publication pressure preserves urgent, control and request admission", async () => {
  const config = applicationConfig();
  const runtime = startRuntime(config);
  try {
    await runtime.applyIntent(localIntent(config));
    holdSettling(runtime, true);
    const options = {allowZeroPeers: true, ignoreDuplicate: true};
    const publications: Promise<unknown>[] = [];
    let refusal: unknown;
    for (let i = 0; i < 1024 && refusal === undefined; i++) {
      const publication = runtime.publishGossip(SYNC, new Uint8Array(144), options);
      publications.push(publication);
      void publication.catch((error) => {
        refusal = error;
      });
      await Promise.resolve();
    }
    expect(refusal).toMatchObject({code: "NetworkGossipPublishFailed", reason: "admission_full"});
    const token = (refusal as {capacityToken: string}).capacityToken;
    expect(token).toEqual(expect.any(String));
    expect(runtime.publicationCapacityWatch(token)).toBe(false);
    const urgent = runtime.publishGossip(BLOCK, new Uint8Array(4000), options);
    const control = runtime.reStatusPeers([]);
    const request = runtime.request(runtime.identity.peerId, REQUEST, new Uint8Array(0));
    holdSettling(runtime, false);
    const [results] = await Promise.all([
      Promise.allSettled(publications),
      urgent,
      control,
      expect(request.next()).rejects.toMatchObject({code: "NetworkRequestRejected", reason: "disconnected"}),
    ]);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    expect(runtime.publicationCapacityWatch(token)).toBe(true);
    for (const result of results) {
      if (result.status === "rejected")
        expect(result.reason).toMatchObject({code: "NetworkGossipPublishFailed", reason: "admission_full"});
    }

    await expect(runtime.publishGossip(SYNC, new Uint8Array(144), options)).resolves.toMatchObject({duplicate: true});
  } finally {
    await runtime.close();
  }
});

test("publication queue deadlines reject invalid inputs before retaining a cell", async () => {
  const runtime = startRuntime(applicationConfig());
  try {
    for (const maxQueueMs of [0, -1, 1.5, Infinity, 86_400_001]) {
      await expect(runtime.publishGossip(BLOCK, new Uint8Array(4000), {maxQueueMs})).rejects.toThrow(
        maxQueueMs === 0 ? "InvalidPublicationQueueTimeout" : "InvalidNetworkInteger"
      );
    }
    expect(() => runtime.publicationCapacityWatch("invalid")).toThrow("InvalidPublicationCapacityToken");
    await expect(
      runtime.publishGossip(BLOCK, new Uint8Array(4000), {allowZeroPeers: true, maxQueueMs: 86_400_000})
    ).resolves.toMatchObject({queued: 0});
  } finally {
    await runtime.close();
  }
});

test("publication turns make progress on payloads larger than the turn byte budget", async () => {
  const config = applicationConfig();
  const runtime = startRuntime(config);
  try {
    await runtime.applyIntent(localIntent(config));
    await Promise.all(
      [3 * 1024 * 1024, 3 * 1024 * 1024, 4000].map((size) =>
        runtime.publishGossip(BLOCK, new Uint8Array(size), {allowZeroPeers: true, ignoreDuplicate: true})
      )
    );
  } finally {
    await runtime.close();
  }
});

test("close settles after every publication and command without exposing their completions", async () => {
  const runtime = startRuntime(applicationConfig());
  holdSettling(runtime, true);
  const order: string[] = [];
  const record = (promise: Promise<unknown>, label: string) =>
    promise.then(
      () => order.push(label),
      () => order.push(label)
    );
  const options = {allowZeroPeers: true, ignoreDuplicate: true};
  const operations = [
    ...Array.from({length: 4}, (_, i) =>
      record(runtime.publishGossip(BLOCK, new Uint8Array(4000).fill(i), options), "publication")
    ),
    record(runtime.reStatusPeers([]), "command"),
    record(runtime.reStatusPeers([]), "command"),
  ];
  const closing = record(runtime.close(), "closed");
  for (let i = 0; i < 400 && !order.includes("closed"); i++) {
    await delay(5);
    runtime.exchange();
  }
  await Promise.all([...operations, closing]);
  expect(order.at(-1)).toBe("closed");
  expect(order.filter((label) => label === "publication")).toHaveLength(4);
  expect(order.filter((label) => label === "command")).toHaveLength(2);
});
