import {setTimeout as delay} from "node:timers/promises";
import {expect, test} from "vitest";
import {
  Settlements,
  applicationConfig,
  localIntent,
  requestForks,
  runtimeReleased,
  startRuntime,
  topicName,
  unreachableConnect,
} from "./utils/network.js";
import {BLOCKS, incomingPair, takeIncoming} from "./utils/network-incoming.js";
import {startPeer} from "./utils/network-peer.js";

/** A fixed-seed mulberry32 generator, so a failing interleaving replays. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Yields nothing, a microtask, a macrotask or a timer, so owner turns and host drains interleave differently. */
async function interleave(random: () => number): Promise<void> {
  const choice = Math.floor(random() * 4);
  if (choice === 1) await undefined;
  else if (choice === 2) await new Promise((resolve) => setImmediate(resolve));
  else if (choice === 3) await delay(1);
}

const outcomes = [
  "resolved",
  "NetworkClosed",
  "NetworkRequestRejected",
  "NetworkRequestFailed",
  "NetworkRequestBusy",
  "NetworkGossipPublishFailed",
  "NetworkCommandFull",
];

async function closeRace(random: () => number): Promise<void> {
  const config = applicationConfig();
  const runtime = startRuntime(config);
  const settlements = new Settlements();
  const unsettled = settlements.unsettledAtClose(runtime.closed);
  await runtime.applyIntent(localIntent(config));
  const streams: ReturnType<typeof runtime.request>[] = [];
  const stream = () => streams[Math.floor(random() * streams.length)];
  const operations = [
    () =>
      settlements.watch(() =>
        runtime.publishGossip(topicName(), new Uint8Array(4000).fill(random() * 256), {
          allowZeroPeers: true,
          ignoreDuplicate: true,
        })
      ),
    () => settlements.watch(() => (random() < 0.5 ? runtime.reStatusPeers([]) : runtime.getPeerScores())),
    () => settlements.watch(() => runtime.connect(...unreachableConnect())),
    () =>
      settlements.watch(() => {
        const started = runtime.request(runtime.identity.peerId, BLOCKS, new Uint8Array(32));
        streams.push(started);
        return started.next();
      }),
    () => streams.length > 0 && settlements.watch(() => stream().next()),
    () => streams.length > 0 && settlements.watch(async () => stream().return?.()),
  ];
  const count = 8 + Math.floor(random() * 32);
  const closeAt = Math.floor(random() * count);
  let closing: Promise<unknown> | undefined;
  for (let i = 0; i < count; i++) {
    if (i === closeAt) closing = runtime.close();
    operations[Math.floor(random() * operations.length)]();
    await interleave(random);
  }
  expect(await closing).toEqual({reason: "requested"});
  await settlements.settled();
  expect(settlements.counts.every((settled) => settled === 1)).toBe(true);
  for (const outcome of settlements.outcomes) expect(outcomes).toContain(outcome);
  expect(await unsettled).toEqual([]);
  await Promise.all(streams.map((started) => started.return?.()));
}

test("every publish, command and request settles exactly once when it races close, and closed settles last", async () => {
  const random = seeded(0x5eed);
  for (let iteration = 0; iteration < 8; iteration++) {
    await closeRace(random);
    await runtimeReleased();
  }
}, 60000);

test("a cancelled request retires on both ends while its peer holds it", async () => {
  const config = applicationConfig();
  const peerConfig = applicationConfig();
  peerConfig.identitySecretKey[31] = 2;
  const peer = await startPeer(peerConfig);
  const runtime = startRuntime(config);
  try {
    await Promise.all([runtime.applyIntent(localIntent(config)), peer.applyIntent(localIntent(peerConfig))]);
    await runtime.connect(peer.identity.peerId, [peer.identity.localEndpoint], 5000n);
    const stream = runtime.request(peer.identity.peerId, BLOCKS, new Uint8Array(32), {responseTimeoutMs: 60000});
    const pending = stream.next();
    void pending.catch(() => undefined);
    const incoming = await takeIncoming(peer);

    const retired = stream.return?.();
    expect(stream.return?.()).toBe(retired);
    expect(await retired).toEqual({done: true, value: undefined});
    await expect(pending).rejects.toMatchObject({code: "NetworkRequestFailed", reason: "cancelled"});
    expect(await stream.next()).toEqual({done: true, value: undefined});

    await incoming.closed;
  } finally {
    await Promise.allSettled([runtime.close(), peer.stop()]);
  }
}, 20000);

test("a rejected response acknowledgement leaves the stream serving for later valid responses", async () => {
  const pair = await incomingPair();
  try {
    // Three roots leave room for two chunks before the client's limit.
    const stream = pair.left.request(pair.remote.peerId, BLOCKS, new Uint8Array(3 * 32));
    const first = stream.next();
    void first.catch(() => undefined);
    const incoming = await takeIncoming(pair.right);
    await expect(incoming.respond(new Uint8Array(4000), null)).rejects.toMatchObject({
      code: "NetworkIncomingRejected",
      reason: "unknown_fork",
    });

    await incoming.respond(new Uint8Array(4000).fill(5), requestForks[0]);
    expect(await first).toMatchObject({done: false, value: {data: new Uint8Array(4000).fill(5)}});
    await expect(incoming.respond(new Uint8Array(1), requestForks[0])).rejects.toMatchObject({
      code: "NetworkIncomingRejected",
      reason: "chunk_too_small",
    });
    const second = stream.next();
    await incoming.respond(new Uint8Array(4000).fill(6), requestForks[0]);
    expect(await second).toMatchObject({done: false, value: {data: new Uint8Array(4000).fill(6)}});
    await incoming.finish();
    expect(await stream.next()).toEqual({done: true, value: undefined});
  } finally {
    await Promise.all([pair.left.stop(), pair.right.close()]);
  }
}, 20000);

test("a terminal while an acknowledgement is pending delivers the acknowledgement before closed", async () => {
  const pair = await incomingPair();
  try {
    const serve = async () => {
      const stream = pair.left.request(pair.remote.peerId, BLOCKS, new Uint8Array(3 * 32));
      const first = stream.next();
      void first.catch(() => undefined);
      const incoming = await takeIncoming(pair.right);
      const order: string[] = [];
      const track = (label: string, promise: Promise<unknown>) =>
        promise.then(
          () => void order.push(label),
          (error: {code: string}) => void order.push(`${label}:${error.code}`)
        );
      void track("closed", incoming.closed);
      return {first, incoming, order, stream, track};
    };
    const payload = new Uint8Array(4000).fill(9);

    // Finish is refused while the acknowledgement is pending; the stream keeps serving and closes after it.
    const finished = await serve();
    const ack = finished.track("ack", finished.incoming.respond(payload, requestForks[0]));
    await finished.track("finish", finished.incoming.finish());
    await ack;
    expect(finished.order).toEqual(["finish:NetworkIncomingBusy", "ack"]);
    expect(await finished.first).toMatchObject({done: false, value: {data: payload}});
    await finished.incoming.finish();
    expect(finished.order).toEqual(["finish:NetworkIncomingBusy", "ack", "closed"]);
    expect(await finished.stream.next()).toEqual({done: true, value: undefined});

    // Cancel is accepted while the acknowledgement is pending; its outcome still comes before closed.
    const cancelled = await serve();
    const cancelledAck = cancelled.track("ack", cancelled.incoming.respond(payload, requestForks[0]));
    expect(cancelled.incoming.cancel()).toBe(cancelled.incoming.closed);
    await Promise.all([cancelledAck, cancelled.incoming.closed]);
    expect(cancelled.order).toHaveLength(2);
    expect(["ack", "ack:NetworkIncomingFailed"]).toContain(cancelled.order[0]);
    expect(cancelled.order[1]).toBe("closed");
    await cancelled.first.catch(() => undefined);
  } finally {
    await Promise.all([pair.left.stop(), pair.right.close()]);
  }
}, 20000);
