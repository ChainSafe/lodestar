import {expect, test, vi} from "vitest";
import type {NativePeerObservation} from "../src/network.js";
import {
  applicationConfig,
  exchange,
  gossipAll,
  holdSettling,
  localIntent,
  metricValue,
  peerIdFromHex,
  requestForks,
  setSlot,
  settleOnly,
  startRuntime,
  topicName,
  waitForGossipReady,
} from "./utils/network.js";
import {startPeer} from "./utils/network-peer.js";
import type {NetworkTestRuntime} from "./utils/network-runtime.js";

test("gossip drain and stale verdict on an activated application", async () => {
  const config = applicationConfig();
  const runtime = startRuntime(config, () => undefined);
  try {
    await runtime.identity;
    await runtime.applyIntent(localIntent(config));
    expect(exchange(runtime, gossipAll).gossip).toBeNull();
    report(runtime, {generation: 1n, index: 0}, "ignore");
  } finally {
    await runtime.close();
  }
});

import {setTimeout as delay} from "node:timers/promises";
import type {NativeApplicationConfig} from "../src/network.js";
import type {NativeGossipHandle, NativeGossipMessage, NativeGossipVerdict} from "../src/network-types.js";
import {BLOCKS, incomingPair, takeIncoming} from "./utils/network-incoming.js";

const TOPIC = topicName();

function blockPayload(size: number, byte = 0): Uint8Array {
  const bytes = new Uint8Array(size).fill(byte);
  new DataView(bytes.buffer).setBigUint64(100, 100n, true);
  return bytes;
}

function report(runtime: NetworkTestRuntime, handle: NativeGossipHandle, value: NativeGossipVerdict) {
  exchange(runtime, settleOnly, [{handle, type: "verdict", verdict: value}]);
}

/** Claims the next gossip block, which queues without a dependency check. */
async function nextGossip(runtime: NetworkTestRuntime): Promise<NativeGossipMessage> {
  for (let i = 0; i < 1000; i++) {
    const {checks, gossip} = exchange(runtime, gossipAll);
    expect(checks).toEqual([]);
    if (gossip?.messages.length) {
      expect(gossip.messages).toHaveLength(1);
      return gossip.messages[0];
    }
    await delay(5);
  }
  throw Error("Gossip delivery deadline");
}
async function gossipPair(budget?: number, configure?: (config: NativeApplicationConfig) => void) {
  const pair = await incomingPair(budget, undefined, (left, right) => {
    configure?.(left);
    configure?.(right);
  });
  try {
    for (const [runtime, config] of [
      [pair.left, pair.leftConfig],
      [pair.right, pair.rightConfig],
    ] as const) {
      const intent = localIntent(config);
      intent.coreTopics = true;
      await runtime.applyIntent(intent);
    }
    await Promise.all([
      pair.left.addDirectPeer(pair.remote.peerId, [pair.remote.localEndpoint]),
      pair.right.addDirectPeer(pair.identity.peerId, [pair.identity.localEndpoint]),
    ]);
    await Promise.all([
      waitForGossipReady(pair.left, [pair.remote.peerId], [TOPIC], () => pair.left.getMetrics()),
      waitForGossipReady(pair.right, [pair.identity.peerId], [TOPIC], () => pair.right.getMetrics()),
    ]);
    return pair;
  } catch (error) {
    await Promise.allSettled([pair.left.stop(), pair.right.close()]);
    throw error;
  }
}

test("gossip lifecycle, strict representations and canonical publication refusals", async () => {
  const config = applicationConfig();
  const runtime = startRuntime(config, () => undefined);
  const handle = {generation: 1n, index: 0};
  try {
    await runtime.identity;
    expect(exchange(runtime, gossipAll).gossip).toBeNull();
    await runtime.applyIntent(localIntent(config));
    for (const malformed of [
      {...handle, generation: 0n},
      {...handle, generation: 1n << 64n},
      {...handle, index: -1},
      {...handle, index: 0.5},
      {...handle, index: Number.MAX_SAFE_INTEGER},
    ])
      expect(() => exchange(runtime, settleOnly, [{handle: malformed, type: "verdict", verdict: "ignore"}])).toThrow();
    expect(() => exchange(runtime, settleOnly, [{handle, type: "verdict", verdict: "ACCEPT" as "accept"}])).toThrow(
      "InvalidGossipVerdict"
    );
    report(runtime, {...handle}, "ignore");
    await expect(
      runtime.publishGossip(TOPIC, new Uint8Array(4000), {flood: 0} as unknown as {flood: boolean})
    ).rejects.toThrow();
    await expect(
      runtime.publishGossip(TOPIC, new Uint8Array(4000), {unknown: true} as unknown as {flood: boolean})
    ).rejects.toThrow();
    await expect(runtime.publishGossip(TOPIC, new Uint16Array(10) as unknown as Uint8Array)).rejects.toThrow();
    const detached = new Uint8Array(4000);
    structuredClone(detached, {transfer: [detached.buffer]});
    await expect(runtime.publishGossip(TOPIC, detached)).rejects.toThrow();
    await expect(runtime.publishGossip("/invalid", new Uint8Array(4000))).rejects.toMatchObject({
      code: "NetworkGossipPublishFailed",
      reason: "unknown_topic",
    });
    await expect(runtime.publishGossip(TOPIC, new Uint8Array(9))).rejects.toMatchObject({
      code: "NetworkGossipPublishFailed",
      reason: "payload_too_small",
    });
    await expect(runtime.publishGossip(TOPIC, new Uint8Array(10 * 1024 * 1024 + 1))).rejects.toMatchObject({
      code: "NetworkGossipPublishFailed",
      reason: "payload_too_large",
    });
    await expect(runtime.publishGossip(TOPIC, new Uint8Array(4000), {allowZeroPeers: false})).rejects.toMatchObject({
      code: "NetworkGossipPublishFailed",
      reason: "no_peers_subscribed_to_topic",
    });
    expect(
      await runtime.publishGossip(TOPIC, new Uint8Array(4000), {
        allowZeroPeers: true,
        flood: false,
        ignoreDuplicate: false,
      })
    ).toEqual({duplicate: false, pressured: 0, queued: 0, selected: 0, unavailable: 0});
    await expect(runtime.publishGossip(TOPIC, new Uint8Array(4000), {ignoreDuplicate: false})).rejects.toMatchObject({
      code: "NetworkGossipPublishFailed",
      reason: "duplicate",
    });
    expect(await runtime.publishGossip(TOPIC, new Uint8Array(4000), {ignoreDuplicate: true})).toEqual({
      duplicate: true,
      pressured: 0,
      queued: 0,
      selected: 0,
      unavailable: 0,
    });
  } finally {
    await runtime.close();
  }
  expect(exchange(runtime, gossipAll).gossip).toBeNull();
  report(runtime, handle, "ignore");
  await expect(runtime.publishGossip(TOPIC, new Uint8Array(4000))).rejects.toThrow("NetworkClosed");
});

test.each(["accept", "reject", "ignore"] as const)(
  "real gossip %s preserves wire identity and exact-once verdict admission",
  async (verdict) => {
    const pair = await gossipPair(undefined, (config) => {
      config.traceGossip = verdict === "accept";
    });
    try {
      const input = blockPayload(4000, 7);
      const before = Date.now();
      const published = pair.left.publishGossip(TOPIC, input, {allowZeroPeers: false});
      input.fill(99);
      expect(await published).toEqual({duplicate: false, pressured: 0, queued: 1, selected: 1, unavailable: 0});
      await delay(40);
      const message = await nextGossip(pair.right);
      await vi.waitFor(
        async () => {
          const sent = await pair.left.getMetrics();
          const received = await pair.right.getMetrics();
          expect(metricValue(sent, "gossipsub_rpc_sent_message_total")).toBe(1);
          expect(metricValue(received, "gossipsub_rpc_recv_message_total")).toBe(1);
          const publishedBytes = metricValue(sent, 'gossipsub_msg_publish_bytes_total{topic="beacon_block"}');
          expect(publishedBytes).toBeGreaterThan(0);
          expect(metricValue(sent, "gossipsub_rpc_sent_bytes_total")).toBeGreaterThan(publishedBytes ?? 0);
          expect(metricValue(received, "gossipsub_rpc_recv_bytes_total")).toBeGreaterThan(publishedBytes ?? 0);
          expect(await pair.left.getMetrics()).toContain(
            'gossipsub_data_recipients_total{origin="publication",outcome="queued"} 1\n'
          );
          expect(await pair.left.getMetrics()).toContain(
            `lodestar_gossip_topic_peers_by_type_count{type="beacon_block",boundary="${requestForks[0].fork}_0"} 1\n`
          );
        },
        {timeout: 5000}
      );
      expect(message.topic).toBe(TOPIC);
      expect(message.data).toEqual(blockPayload(4000, 7));
      expect(message.peerId).toEqual(pair.identity.peerId);
      expect(message.connection).toEqual((await pair.right.observePeers()).peers[0].connection);
      const {messageId} = await import("../../test/interop/codec.mjs");
      expect(Buffer.from(message.id)).toEqual(messageId(TOPIC, blockPayload(4000, 7)));
      expect(message.receivedAtUnixMs).toBeGreaterThanOrEqual(before);
      expect(message.receivedAtUnixMs).toBeLessThan(Date.now());
      expect(Number.isSafeInteger(message.receivedAtUnixMs)).toBe(true);

      message.connection.generation++;
      message.data.fill(0);
      report(pair.right, message.handle, verdict);
      report(pair.right, message.handle, verdict);
      const verdictMetric = {accept: "accepted", ignore: "ignored", reject: "rejected"}[verdict];
      await vi.waitFor(
        async () => {
          const metrics = await pair.right.getMetrics();
          expect(metrics).toContain(`gossipsub_${verdictMetric}_messages_total{topic="beacon_block"} 1\n`);
          expect(metrics).toContain("gossipsub_async_validation_delay_from_first_seen_count 1\n");
        },
        {timeout: 5000}
      );
      const sentTrace = (await pair.left.drainLogs(256)).records.filter((r) => r.scope === "network_gossip_trace");
      const receivedTrace = pair.right.drainLogs(256).records.filter((r) => r.scope === "network_gossip_trace");
      if (verdict === "accept") {
        const id = Buffer.from(message.id).toString("hex");
        expect(sentTrace.map((r) => r.message.split(" ")[0])).toEqual(["queued", "send", "send"]);
        expect(sentTrace[0].message).toContain(`message_id=${id}`);
        expect(sentTrace[1].message).toContain("outcome=active");
        expect(sentTrace[2].message).toContain("outcome=quic_accepted");
        const delivery = sentTrace[0].message.match(/ message=(\d+:\d+) connection=(\d+:\d+)/)?.[0];
        expect(delivery).toBeDefined();
        expect(sentTrace[1].message).toContain(delivery);
        expect(sentTrace[2].message).toContain(delivery);
        expect(receivedTrace.map((r) => r.message.split(" ")[0]).sort()).toEqual([
          "handed_to_js",
          "receive",
          "validation",
        ]);
        for (const record of receivedTrace) {
          expect(record.message).toContain(`message_id=${id}`);
          expect(Buffer.byteLength(record.message)).toBeLessThan(768);
        }
        const receive = receivedTrace.find((r) => r.message.startsWith("receive "));
        expect(receive?.message).toMatch(/frame_started_ms=\d+ frame_complete_ms=\d+/);
        expect(receivedTrace.find((r) => r.message.startsWith("validation "))?.message).toContain("verdict=accept");
      } else {
        expect(sentTrace).toEqual([]);
        expect(receivedTrace).toEqual([]);
      }
      const page = await pair.right.getGossipDiagnostics();
      expect(page.observedMonoMs).toBeGreaterThan(0n);
      expect(page.observedUnixMs).toBeGreaterThanOrEqual(BigInt(before - 1000));
      expect(page.observedMonoMs).toBeGreaterThan(0n);
      expect(page.nextCursor).toBeNull();
      const topic = page.topics.find((entry) => entry.topic === TOPIC);
      expect(topic).toMatchObject({subscribed: true, topic: TOPIC});
      expect(page.peers).toHaveLength(1);
      const scored = page.peers[0];
      expect(scored.identity).toEqual(pair.identity.peerId);
      expect(scored.connected).toBe(true);
      expect(scored.outboundReady).toBe(true);
      expect(Number.isFinite(scored.score)).toBe(true);
      expect(scored.appScore).toBe(0);
      expect(scored.weights.p5).toBe(0);
      if (verdict === "reject") {
        expect(scored.topics.find((entry) => entry.index === topic?.index)?.invalidMessageDeliveries).toBeGreaterThan(
          0
        );
        expect(scored.topics.find((entry) => entry.index === topic?.index)?.weights.p4).toBeLessThan(0);
      }

      scored.ip.fill(0);
      scored.topics.length = 0;
      expect((await pair.right.getGossipDiagnostics()).peers[0].identity).toEqual(pair.identity.peerId);
      expect(await pair.left.getMetrics()).toContain(
        'gossipsub_data_recipients_total{origin="publication",outcome="completed"} 1\n'
      );
    } finally {
      await Promise.all([pair.left.stop(), pair.right.close()]);
    }
  },
  15000
);

test("gossip delivery and direct verdict reports progress with a full command table", async () => {
  const pair = await gossipPair();
  const commands: Promise<PromiseSettledResult<unknown>[]>[] = [];
  try {
    holdSettling(pair.right, true);

    commands.push(Promise.allSettled(Array.from({length: 31}, () => pair.right.getMetrics())));
    expect(() => pair.right.getMetrics()).toThrow("NetworkCommandFull");

    await pair.left.publishGossip(TOPIC, blockPayload(4000, 4), {allowZeroPeers: false});
    const message = await nextGossip(pair.right);
    const refill: Promise<string>[] = [];
    for (let i = 0; i < 31; i++) {
      try {
        refill.push(pair.right.getMetrics());
      } catch (error) {
        expect(error).toMatchObject({code: "NetworkCommandFull"});
        break;
      }
    }
    commands.push(Promise.allSettled(refill));
    expect(() => pair.right.getMetrics()).toThrow("NetworkCommandFull");
    pair.right.reportGossip(message.handle, "accept");
    expect(() => pair.right.getMetrics()).toThrow("NetworkCommandFull");

    holdSettling(pair.right, false);
    for (const outcome of (await Promise.all(commands)).flat()) expect(outcome.status).toBe("fulfilled");
  } finally {
    holdSettling(pair.right, false);
    await Promise.all([pair.left.stop(), pair.right.close()]);
    await Promise.all(commands);
  }
}, 15000);

test("gossip payload credit retires on close while descriptors remain held", async () => {
  const pair = await gossipPair();
  try {
    await pair.left.publishGossip(TOPIC, blockPayload(4000, 2), {allowZeroPeers: false});
    const message = await nextGossip(pair.right);
    await pair.right.close();
    expect(message.data).toEqual(blockPayload(4000, 2));
    report(pair.right, message.handle, "accept");
  } finally {
    await Promise.all([pair.left.stop(), pair.right.close()]);
  }
}, 15000);
test("gossip and both request directions retain independent payload capacity", async () => {
  const pair = await gossipPair(256 * 1024 * 1024);
  try {
    const outgoing = pair.right.request(pair.identity.peerId, BLOCKS, new Uint8Array(32));
    const outboundPull = outgoing.next();
    void outboundPull.catch(() => undefined);
    const inbound = await takeIncoming(pair.left);
    const reverse = pair.left.request(pair.remote.peerId, BLOCKS, new Uint8Array(32));
    const inboundPull = reverse.next();
    void inboundPull.catch(() => undefined);
    const serving = await takeIncoming(pair.right);

    await pair.left.publishGossip(TOPIC, blockPayload(10 * 1024 * 1024, 17), {allowZeroPeers: false});
    const message = await nextGossip(pair.right);
    expect(Buffer.from(message.data).equals(blockPayload(10 * 1024 * 1024, 17))).toBe(true);
    report(pair.right, message.handle, "ignore");
    await Promise.all([
      inbound.respond(new Uint8Array(4000).fill(1), requestForks[0]),
      serving.respond(new Uint8Array(4000).fill(2), requestForks[0]),
    ]);
    expect(await outboundPull).toMatchObject({value: {data: new Uint8Array(4000).fill(1)}});
    expect(await inboundPull).toMatchObject({value: {data: new Uint8Array(4000).fill(2)}});
    const done = [outgoing.next(), reverse.next()];
    await Promise.all([inbound.finish(), serving.finish()]);
    expect(await Promise.all(done)).toEqual([
      {done: true, value: undefined},
      {done: true, value: undefined},
    ]);
    const statusAt = (await pair.right.observePeers()).peers[0].statusAtMs;
    await pair.right.reStatusPeers([pair.identity.peerId]);
    let statusUpdated = false;
    for (let i = 0; i < 1000; i++) {
      if ((await pair.right.observePeers()).peers[0].statusAtMs > statusAt) {
        statusUpdated = true;
        break;
      }
      await delay(5);
    }
    expect(statusUpdated).toBe(true);
  } finally {
    await Promise.all([pair.left.stop(), pair.right.close()]);
  }
}, 20000);

import {readFile} from "node:fs/promises";

const HOST = process.env.LODESTAR_Z_NETWORK_STOCK_HOST;
const HOODI = process.env.LODESTAR_Z_NETWORK_HOODI_FIXTURE;
for (const hoodi of [false, true]) {
  test.skipIf(!HOST || (hoodi && !HOODI))(
    `pinned stock gossip ${hoodi ? "Hoodi sample" : "wire IDs and same-fork BPO topics"}`,
    async () => {
      const {Child} = await import("../../test/interop/child.mjs");
      const {messageId, payload, summary} = await import("../../test/interop/codec.mjs");
      const peer = new Child("gossip-stock", process.execPath, [
        "--import",
        "tsx",
        "test/interop/request_responder.mjs",
        HOST ?? "",
        HOODI ?? "",
        "gossip",
      ]);
      let runtime: NetworkTestRuntime | undefined;
      try {
        const info = await peer.command("ready");
        const config = applicationConfig();
        setSlot(config, 2000n * 32n);
        const firstTopic = topicName("beacon_block", 2);
        const secondTopic = topicName("beacon_block", 3);
        runtime = startRuntime(config, () => undefined);
        const identity = await runtime.identity;
        const intent = localIntent(config);
        intent.coreTopics = true;
        await runtime.applyIntent(intent);
        await peer.command("gossipSubscribe", {topic: firstTopic});
        await peer.command("gossipSubscribe", {topic: secondTopic});
        const remote = peerIdFromHex(info.peer);
        const endpoint = {
          address: Uint8Array.of(127, 0, 0, 1),
          family: 4 as const,
          port: Number(info.address.split("/")[4]),
        };
        await runtime.addDirectPeer(remote, [endpoint]);
        await runtime.connect(remote, [endpoint], 5000n);
        for (let i = 0; i < 100; i++) {
          const state = await peer.command("gossipStats");
          if (state.subscribers.every((entry: {count: number}) => entry.count === 1)) break;
          await delay(25);
        }
        for (const [index, topic] of [firstTopic, secondTopic].entries()) {
          const sent = await peer.command("gossipPublish", {length: 4000, seed: 71 + index, slot: 100, topic});
          const message = await nextGossip(runtime);
          expect(message.topic).toBe(topic);
          expect(Buffer.from(message.id).toString("hex")).toBe(sent.messageId);
          expect(message.peerId).toEqual(remote);
          const expected = payload(4000, 71 + index);
          expected.writeBigUInt64LE(100n, 100);
          expect(summary(message.data)).toEqual(summary(expected));
          report(runtime, message.handle, index === 0 ? "accept" : "ignore");
          const data = payload(4000, 81 + index);
          data.writeBigUInt64LE(100n, 100);
          expect(await runtime.publishGossip(topic, data, {allowZeroPeers: false})).toMatchObject({
            queued: 1,
            selected: 1,
          });
          for (let i = 0; i < 100; i++) {
            const state = await peer.command("gossipStats");
            if (state.messages.length > index) break;
            await delay(10);
          }
          const state = await peer.command("gossipStats");
          expect(state.messages[index]).toMatchObject({
            ...summary(data),
            messageId: messageId(topic, data).toString("hex"),
            topic,
          });
        }
        // One peer holds at most half of a kind's processor items pending validation.
        const held = 4;
        if (!hoodi) {
          for (let i = 0; i < 64; i++)
            await peer.command("gossipPublish", {length: 4000, seed: 900 + i, slot: 100, topic: firstTopic});
          const active = runtime;
          await expect
            .poll(
              async () =>
                metricValue(await active.getMetrics(), 'lodestar_gossip_validation_queue_length{topic="beacon_block"}'),
              {timeout: 5000}
            )
            .toBe(held);
        }
        expect(
          await peer.command("ping", {addressBytes: Buffer.from(identity.localMultiaddr).toString("hex")})
        ).toMatchObject({length: 8});
        if (!hoodi) {
          const messages = exchange(runtime, gossipAll).gossip?.messages ?? [];
          expect(messages).toHaveLength(held);
          exchange(
            runtime,
            settleOnly,
            messages.map(({handle}) => ({handle, type: "verdict", verdict: "ignore"}))
          );
        }
        if (hoodi && HOODI) {
          const data = await readFile(HOODI);
          expect(data.length).toBe(17569);
          const sent = await peer.command("gossipPublish", {hoodi: true, length: data.length, topic: firstTopic});
          const message = await nextGossip(runtime);
          expect(message.data).toEqual(new Uint8Array(data));
          expect(Buffer.from(message.id).toString("hex")).toBe(sent.messageId);
          report(runtime, message.handle, "reject");
        }
      } finally {
        await Promise.allSettled([runtime?.close(), peer.stop()]);
      }
    },
    20000
  );
}

test("closed runtime rejects a retained verdict", async () => {
  const pair = await gossipPair();
  try {
    await pair.left.publishGossip(TOPIC, blockPayload(4000));
    const old = await nextGossip(pair.right);
    await pair.right.close();
    report(pair.right, old.handle, "accept");
  } finally {
    await Promise.all([pair.left.stop(), pair.right.close()]);
  }
}, 15000);

test("gossip diagnostics validate cursors and share one diagnostic buffer", async () => {
  const config = applicationConfig();
  const runtime = startRuntime(config, () => undefined);
  try {
    await runtime.identity;
    await runtime.applyIntent({...localIntent(config), coreTopics: true});
    for (const cursor of [-1, 0.5, 513, Number.NaN]) {
      expect(() => runtime.getGossipDiagnostics(cursor)).toThrow();
    }
    const snapshot = runtime.getGossipDiagnostics();
    const scores = runtime.getPeerScores();
    const changed = runtime.applyIntent({coreTopics: false});
    const following = runtime.getGossipDiagnostics();
    const page = await snapshot;
    expect((await scores).peers).toEqual([]);
    const later = await following;
    await changed;
    expect(later.peers).toEqual(page.peers);
    expect(page.topics.find((topic) => topic.topic === topicName())?.subscribed).toBe(true);
    expect(later.topics.find((topic) => topic.topic === topicName())?.subscribed ?? false).toBe(false);
    expect(page).toMatchObject({nextCursor: null, peers: []});
    await expect(runtime.getGossipDiagnostics(512)).rejects.toThrow("InvalidDiagnosticsCursor");
  } finally {
    await runtime.close();
  }
  expect(() => runtime.getGossipDiagnostics()).toThrow("NetworkClosed");
});

test("gossip diagnostics paginate retained peers while observations remove disconnected peers", async () => {
  const config = applicationConfig();
  const observations: NativePeerObservation[] = [];
  const runtime = startRuntime(
    config,
    () => undefined,
    (events) => observations.push(...events)
  );
  const identities = new Set<string>();
  try {
    await runtime.identity;
    await runtime.applyIntent(localIntent(config));
    for (let i = 0; i < 9; i++) {
      const remoteConfig = applicationConfig();
      remoteConfig.identitySecretKey[31] = 70 + i;
      const remote = await startPeer(remoteConfig);
      try {
        const identity = await remote.identity;
        identities.add(identity.peerId);
        await remote.applyIntent(localIntent(remoteConfig));
        await runtime.connect(identity.peerId, [identity.localEndpoint], 5000n);
        await vi.waitFor(
          async () => {
            const page = await remote.getGossipDiagnostics();
            expect(page.peers).toHaveLength(1);
            expect(page.peers[0].outboundReady).toBe(true);
          },
          {timeout: 5000}
        );
        await runtime.disconnect(identity.peerId);
      } finally {
        await remote.stop();
      }
    }
    const first = await runtime.getGossipDiagnostics();
    expect(first.peers).toHaveLength(8);
    expect(first.nextCursor).not.toBeNull();
    const second = await runtime.getGossipDiagnostics(first.nextCursor ?? 0);
    expect(second.peers).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(second.observedMonoMs).toBeGreaterThanOrEqual(first.observedMonoMs);
    expect(new Set([...first.peers, ...second.peers].map((peer) => peer.identity))).toEqual(identities);
    expect([...first.peers, ...second.peers].every((peer) => !peer.connected)).toBe(true);
    await vi.waitFor(() =>
      expect(observations.filter((event) => event.type === "closed")).toHaveLength(identities.size)
    );
    const closed = observations.filter((event) => event.type === "closed");
    expect(closed).toHaveLength(identities.size);
    expect(new Set(closed.map((event) => event.identity))).toEqual(identities);
    expect(closed.every((event) => event.reason === "host")).toBe(true);
  } finally {
    await runtime.close();
  }
}, 45000);
