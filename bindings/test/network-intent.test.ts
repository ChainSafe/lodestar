import {expect, test} from "vitest";
import {
  applicationConfig,
  configureChain,
  discoveryConfig,
  localIntent,
  startRuntime,
  topicName,
} from "./utils/network.js";

test("sparse intents derive subscriptions and reject invalid changes atomically", async () => {
  const config = applicationConfig();
  const runtime = startRuntime(config);
  try {
    await runtime.applyIntent({coreTopics: true});
    expect(
      (await runtime.getGossipDiagnostics()).topics.some((topic) => topic.subscribed && topic.topic === topicName())
    ).toBe(true);
    const before = await runtime.observeIdentity();
    for (const [patch, error] of [
      [{custodyGroupCount: 0n}, "InvalidCustodyCount"],
      [{attesters: [{aggregators: 2n, slot: 100, subnets: 1n}]}, "InvalidCommitteeDuty"],
      [{attesters: [{aggregators: 1n, slot: 10000, subnets: 1n}]}, "InvalidCommitteeDuty"],
      [{syncCommittees: [{subnet: 4, untilSlot: 200}]}, "InvalidNetworkInteger"],
    ] as const) {
      await expect(runtime.applyIntent({...patch, coreTopics: false})).rejects.toThrow(error);
      expect((await runtime.observeIdentity()).metadata).toEqual(before.metadata);
      expect(
        (await runtime.getGossipDiagnostics()).topics.some((topic) => topic.subscribed && topic.topic === topicName())
      ).toBe(true);
    }
    await runtime.applyIntent({coreTopics: false});
    expect(
      (await runtime.getGossipDiagnostics()).topics.some((topic) => topic.subscribed && topic.topic === topicName())
    ).toBe(false);
  } finally {
    await runtime.close();
  }
});

test("duty arrays reject malformed inputs without consuming admission", async () => {
  const runtime = startRuntime(applicationConfig());
  try {
    for (const malformed of [
      {attesters: new Uint8Array(4)},
      {attesters: [{aggregators: 0n, slot: -1, subnets: 1n}]},
      {attesters: [{aggregators: 0n, slot: 100, subnets: 1n << 64n}]},
      {syncCommittees: new Array(5).fill({subnet: 0, untilSlot: 200})},
      {subscriptions: []},
    ]) {
      // @ts-expect-error Exercise invalid public API inputs.
      await expect(runtime.applyIntent(malformed)).rejects.toThrow();
      await runtime.applyIntent({});
    }
    await runtime.applyIntent({
      syncCommittees: [
        {subnet: 1, untilSlot: 200},
        {subnet: 1, untilSlot: 150},
      ],
    });
    expect((await runtime.observeIdentity()).metadata.syncnets).toBe(2);
  } finally {
    await runtime.close();
  }
});

test("startup rejects a scheduled three-boundary topic overflow", () => {
  const config = applicationConfig();
  configureChain(config, {
    BLOB_SCHEDULE: [
      {EPOCH: 2001, MAX_BLOBS_PER_BLOCK: 33},
      {EPOCH: 2002, MAX_BLOBS_PER_BLOCK: 66},
    ],
  });
  expect(() => startRuntime(config)).toThrow("UnsupportedTopicOverlap");
});

test("host changes preserve native advertisement and reject endpoint overrides", async () => {
  const config = discoveryConfig();
  const runtime = startRuntime(config);
  try {
    const before = (await runtime.observeIdentity()).localEnr;
    const intent = localIntent(config);
    Reflect.set(intent, "endpoints", {ip4: Uint8Array.of(192, 0, 2, 1)});
    await expect(runtime.applyIntent(intent)).rejects.toThrow("InvalidNetworkConfig");
    expect((await runtime.observeIdentity()).localEnr).toEqual(before);
  } finally {
    await runtime.close();
  }
});
