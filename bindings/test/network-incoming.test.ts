import {expect, test} from "vitest";
import {
  applicationConfig,
  holdSettling,
  localIntent,
  metricValue,
  nextIncoming,
  requestForks,
  startRuntime,
} from "./utils/network.js";
import {drainUntil} from "./utils/network-bindings.js";
import {BLOCKS, incomingPair, takeIncoming} from "./utils/network-incoming.js";

test("incoming cancellation retains execution until host work retires", async () => {
  const pair = await incomingPair();
  let retire: () => void = () => undefined;
  const retired = new Promise<void>((resolve) => {
    retire = resolve;
  });
  try {
    const stream = pair.left.request(pair.remote.peerId, BLOCKS, new Uint8Array(32));
    const pending = stream.next().catch(() => undefined);
    const incoming = await takeIncoming(pair.right);
    incoming.retainUntil(retired);
    expect(() => incoming.retainUntil(retired)).toThrow("NetworkIncomingRetentionInvalid");
    await incoming.cancel();
    await pending;

    const retiring = async () => metricValue(await pair.right.getMetrics(), "beacon_reqresp_retiring_count");
    await expect.poll(retiring, {timeout: 5000}).toBe(1);
    retire();
    await expect.poll(retiring, {timeout: 5000}).toBe(0);
  } finally {
    retire();
    await Promise.all([pair.left.stop(), pair.right.close()]);
  }
}, 15000);

test("incoming response permission precedes payload production", async () => {
  const pair = await incomingPair();
  try {
    const stream = pair.left.request(pair.remote.peerId, BLOCKS, new Uint8Array(32));
    const pending = stream.next();
    void pending.catch(() => undefined);
    const incoming = await takeIncoming(pair.right);
    const permission = incoming.ready();
    await expect(incoming.ready()).rejects.toMatchObject({code: "NetworkIncomingBusy"});
    await permission;

    const payload = new Uint8Array(4000).fill(17);
    await incoming.respond(payload, requestForks[0]);
    expect(await pending).toMatchObject({done: false, value: {data: payload}});
    await incoming.finish();
    await expect(incoming.ready()).rejects.toMatchObject({code: "NetworkIncomingClosed"});
  } finally {
    await Promise.all([pair.left.stop(), pair.right.close()]);
  }
}, 15000);

test("incoming copied metadata and acknowledged multiple contexts preserve wire bytes", async () => {
  const pair = await incomingPair();
  try {
    // Leave room below the client chunk limit so this test observes server EOF, not client cancellation.
    const query = new Uint8Array(3 * 32).fill(7);
    const stream = pair.left.request(pair.remote.peerId, BLOCKS, query);
    const pending = stream.next();
    void pending.catch(() => undefined);
    const incoming = await takeIncoming(pair.right);
    expect(incoming.data).toEqual(query);
    expect(incoming.protocol).toBe(BLOCKS);
    expect(incoming.peerId).toEqual(pair.identity.peerId);
    const peers = await pair.right.observePeers();
    expect(incoming.connection).toEqual(peers.peers[0].connection);

    incoming.connection.generation++;
    incoming.data.fill(0);
    const payload = new Uint8Array(4000).fill(31);
    const ack = incoming.respond(payload, requestForks[0]);
    payload.fill(99);
    await expect(incoming.respond(payload, null)).rejects.toMatchObject({code: "NetworkIncomingBusy"});
    await expect(incoming.finish()).rejects.toMatchObject({code: "NetworkIncomingBusy"});
    await ack;
    expect(await pending).toMatchObject({
      done: false,
      value: {data: new Uint8Array(4000).fill(31), fork: "deneb", protocol: BLOCKS},
    });
    const second = stream.next();
    await incoming.respond(new Uint8Array(4000).fill(42), requestForks[1]);
    expect(await second).toMatchObject({done: false, value: {data: new Uint8Array(4000).fill(42)}});
    const done = stream.next();
    expect(incoming.finish()).toBe(incoming.closed);
    expect(incoming.fail(139, new Uint8Array())).toBe(incoming.closed);
    expect(await incoming.closed).toBeUndefined();
    expect(await done).toEqual({done: true, value: undefined});
    await expect(incoming.respond(payload, null)).rejects.toMatchObject({code: "NetworkIncomingClosed"});
  } finally {
    await Promise.all([pair.left.stop(), pair.right.close()]);
  }
}, 15000);

test.each([1, 2, 3, 128, 139, 255])(
  "incoming error status %s preserves exact encoded bytes",
  async (status) => {
    const pair = await incomingPair();
    try {
      const stream = pair.left.request(pair.remote.peerId, BLOCKS, new Uint8Array(32));
      const pending = stream.next();
      void pending.catch(() => undefined);
      const rejection = expect(pending).rejects.toMatchObject({
        code: "NetworkRequestFailed",
        peerMessage: new TextEncoder().encode("limité 超"),
        peerStatus: status,
        reason: "peer_error",
      });
      const incoming = await takeIncoming(pair.right);
      expect(incoming.fail(status, new TextEncoder().encode("limité 超"))).toBe(incoming.closed);
      expect(await incoming.closed).toBeUndefined();
      await rejection;
    } finally {
      await Promise.all([pair.left.stop(), pair.right.close()]);
    }
  },
  15000
);

test("incoming invalid context keeps the serving slot and empty finish reaches wire EOF", async () => {
  const pair = await incomingPair();
  try {
    const stream = pair.left.request(pair.remote.peerId, BLOCKS, new Uint8Array(32));
    const pending = stream.next();
    void pending.catch(() => undefined);
    const incoming = await takeIncoming(pair.right);
    await expect(incoming.respond(new Uint8Array(4000), null)).rejects.toMatchObject({
      code: "NetworkIncomingRejected",
      reason: "unknown_fork",
    });
    await expect(
      incoming.respond(new Uint8Array(4000), {digest: requestForks[0].digest, fork: "electra"})
    ).rejects.toMatchObject({code: "NetworkIncomingRejected", reason: "unknown_fork"});
    await expect(incoming.respond(new Uint8Array(1), requestForks[0])).rejects.toMatchObject({
      code: "NetworkIncomingRejected",
      reason: "chunk_too_small",
    });
    expect(incoming.finish()).toBe(incoming.closed);
    expect(await incoming.closed).toBeUndefined();
    expect(await pending).toEqual({done: true, value: undefined});
  } finally {
    await Promise.all([pair.left.stop(), pair.right.close()]);
  }
}, 15000);

test("incoming input validation rolls back before a later valid response", async () => {
  const pair = await incomingPair();
  try {
    const stream = pair.left.request(pair.remote.peerId, BLOCKS, new Uint8Array(32));
    const pending = stream.next();
    void pending.catch(() => undefined);
    const incoming = await takeIncoming(pair.right);
    for (const status of [0, -1, 4, 5, 127, 256, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(incoming.fail(status, new Uint8Array())).rejects.toMatchObject({
        code: "NetworkIncomingRejected",
        reason: "invalid_error",
      });
    }
    const extraContext = {...requestForks[0], unexpected: true};
    await expect(incoming.respond(new Uint8Array(4000), extraContext)).rejects.toMatchObject({
      code: "InvalidNetworkConfig",
    });
    await expect(
      incoming.respond(new Uint8Array(4000), {digest: new Uint8Array(3), fork: "deneb"})
    ).rejects.toMatchObject({
      code: "InvalidNetworkBytes",
    });
    await expect(incoming.fail(2, new Uint8Array(257))).rejects.toMatchObject({
      code: "NetworkIncomingRejected",
      reason: "invalid_error",
    });
    const oversized = new Uint8Array(10 * 1024 * 1024 + 1);
    await expect(incoming.respond(oversized, requestForks[0])).rejects.toMatchObject({
      code: "NetworkIncomingRejected",
      reason: "chunk_too_large",
    });
    const detached = new Uint8Array(4000);
    structuredClone(detached.buffer, {transfer: [detached.buffer]});
    await expect(incoming.respond(detached, requestForks[0])).rejects.toMatchObject({code: "InvalidNetworkBytes"});

    await incoming.respond(new Uint8Array(4000), requestForks[0]);
    expect((await pending).done).toBe(false);
    await incoming.finish();
    expect((await stream.next()).done).toBe(true);
  } finally {
    await Promise.all([pair.left.stop(), pair.right.close()]);
  }
}, 15000);

test("incoming chunk ceiling rejects an extra response without losing finish", async () => {
  const pair = await incomingPair();
  try {
    const stream = pair.left.request(pair.remote.peerId, BLOCKS, new Uint8Array(32));
    const first = stream.next();
    void first.catch(() => undefined);
    const incoming = await takeIncoming(pair.right);
    await incoming.respond(new Uint8Array(4000), requestForks[0]);
    expect((await first).done).toBe(false);
    await expect(incoming.respond(new Uint8Array(4000), requestForks[0])).rejects.toMatchObject({
      code: "NetworkIncomingRejected",
      reason: "too_many_chunks",
    });
    // Consuming the final chunk closes the client stream; finish the server first.
    expect(await incoming.finish()).toBeUndefined();
    expect((await stream.next()).done).toBe(true);
  } finally {
    await Promise.all([pair.left.stop(), pair.right.close()]);
  }
}, 15000);
const stock = test.skipIf(!process.env.LODESTAR_Z_NETWORK_STOCK_HOST);
stock(
  "pinned stock decoder receives native responses, contexts, full payload and error statuses",
  async () => {
    const {Child} = await import("../../test/interop/child.mjs");
    const {payload, summary} = await import("../../test/interop/codec.mjs");
    let peer: InstanceType<typeof Child> | undefined;
    let runtime: ReturnType<typeof startRuntime> | undefined;
    try {
      const host = process.env.LODESTAR_Z_NETWORK_STOCK_HOST;
      if (!host) throw Error("stock host path required");
      peer = new Child("incoming-stock", process.execPath, [
        "--import",
        "tsx",
        "test/interop/request_responder.mjs",
        host,
      ]);
      await peer.command("ready");
      const config = applicationConfig();
      config.resources.bridgeBudgetBytes = 512 * 1024 * 1024;
      runtime = startRuntime(config, () => undefined);
      const identity = await runtime.identity;
      await runtime.applyIntent(localIntent(config));
      const addressBytes = Buffer.from(identity.localMultiaddr).toString("hex");
      for (const status of [0, 1, 2, 3, 139]) {
        const reply = peer.command("request", {addressBytes});
        const incoming = await takeIncoming(runtime);
        if (status === 0) {
          const first = payload(4000, 18);
          const second = payload(10 * 1024 * 1024, 19);
          await incoming.respond(first, requestForks[0]);
          await incoming.respond(second, requestForks[1]);
          await incoming.finish();
          expect(await reply).toMatchObject({
            chunks: [
              {...summary(first), fork: "deneb"},
              {...summary(second), fork: "electra"},
            ],
            contexts: requestForks.slice(0, 2).map(({digest}) => Buffer.from(digest).toString("hex")),
          });
        } else {
          await incoming.fail(status, new TextEncoder().encode("limit reached"));
          expect(await reply).toMatchObject({chunks: [], message: "limit reached", status});
        }
      }
      const empty = peer.command("request", {addressBytes});
      await (await takeIncoming(runtime)).finish();
      expect(await empty).toMatchObject({chunks: []});
    } finally {
      await Promise.allSettled([runtime?.close(), peer?.stop()]).then((results) => {
        for (const result of results) if (result.status === "rejected") throw result.reason;
      });
    }
  },
  60000
);

stock(
  "stock sequential requests past the native start quota negotiate and wait for their start",
  async () => {
    const {Child} = await import("../../test/interop/child.mjs");
    let peer: InstanceType<typeof Child> | undefined;
    let runtime: ReturnType<typeof startRuntime> | undefined;
    try {
      const host = process.env.LODESTAR_Z_NETWORK_STOCK_HOST;
      if (!host) throw Error("stock host path required");
      peer = new Child("incoming-stock-starts", process.execPath, [
        "--import",
        "tsx",
        "test/interop/request_responder.mjs",
        host,
      ]);
      await peer.command("ready");
      const config = applicationConfig();
      config.resources.bridgeBudgetBytes = 512 * 1024 * 1024;
      const live = startRuntime(config, () => undefined);
      runtime = live;
      const identity = await live.identity;
      await live.applyIntent(localIntent(config));
      live.setLogLevel("debug");
      const addressBytes = Buffer.from(identity.localMultiaddr).toString("hex");
      let waits = 0;
      let refusals = 0;
      const drain = () => {
        for (let batch = 0; batch < 8; batch++) {
          const drained = live.drainLogs(32);
          for (const {message} of drained.records) {
            if (message.startsWith("request_start_wait ")) waits += 1;
            if (message.startsWith("request_admission_refused ")) refusals += 1;
          }
          if (!drained.more) return;
        }
      };
      // An identity starts 36 application requests per 10 s. Requests continue until a wait record
      // shows the quota exhausted, then four more; every one must negotiate and complete.
      let sent = 0;
      let afterWait = 0;
      while (sent < 400 && afterWait < 4) {
        const reply = peer.command("request", {addressBytes});
        await (await takeIncoming(live)).finish();
        expect(await reply).toMatchObject({chunks: []});
        sent += 1;
        drain();
        if (waits > 0) afterWait += 1;
      }
      expect(waits).toBeGreaterThan(0);
      expect(refusals).toBe(0);
    } finally {
      await Promise.allSettled([runtime?.close(), peer?.stop()]).then((results) => {
        for (const result of results) if (result.status === "rejected") throw result.reason;
      });
    }
  },
  60000
);

test("terminal before take never exposes a retired request", async () => {
  const pair = await incomingPair();
  try {
    const stream = pair.left.request(pair.remote.peerId, BLOCKS, new Uint8Array(32));
    const pending = stream.next().catch(() => undefined);
    const waiting = async () =>
      metricValue(await pair.right.getMetrics(), 'beacon_reqresp_incoming_count{phase="waiting_host"}');
    await expect.poll(waiting, {timeout: 5000}).toBe(1);
    await stream.return?.();
    await pair.left.disconnect(pair.remote.peerId);
    await pending;
    await expect.poll(waiting, {timeout: 5000}).toBe(0);
    expect(nextIncoming(pair.right)).toBeNull();
  } finally {
    await Promise.all([pair.left.stop(), pair.right.close()]);
  }
}, 15000);

test("a ready incoming response delivers its bytes and preserves control progress", async () => {
  const pair = await incomingPair();
  try {
    const pending = pair.left.request(pair.remote.peerId, BLOCKS, new Uint8Array(32)).next();
    void pending.catch(() => undefined);
    const incoming = await takeIncoming(pair.right);

    await incoming.ready();

    const data = new Uint8Array(4000).fill(42);
    await incoming.respond(data, requestForks[0]);
    expect((await pending).value?.data).toEqual(data);

    await incoming.finish();
    await pair.right.reStatusPeers([pair.identity.peerId]);
    expect((await pair.right.observeIdentity()).peerId).toEqual(pair.remote.peerId);
  } finally {
    await Promise.all([pair.left.stop(), pair.right.close()]);
  }
}, 20000);

/** Reproducible bytes that snappy cannot compress, so their frame stays as large as they are. */
function incompressible(length: number, seed: number): Uint8Array {
  const data = new Uint8Array(length);
  let state = seed;
  for (let i = 0; i < length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    data[i] = state & 0xff;
  }
  return data;
}

/** Records the order in which a stream's close and its pending call settle. */
function settlementOrder(closed: Promise<void>, pending: Promise<unknown>) {
  const order: string[] = [];
  void pending.then(
    () => order.push("pending"),
    (error) => order.push(error.code)
  );
  void closed.then(() => order.push("closed"));
  return order;
}

test("a permission the stream's end overtakes arrives with the close and settles after it, refused", async () => {
  const pair = await incomingPair();
  holdSettling(pair.right, true);
  try {
    const stream = pair.left.request(pair.remote.peerId, BLOCKS, new Uint8Array(32));
    const pending = stream.next().catch(() => undefined);
    const incoming = await takeIncoming(pair.right);
    const permission = incoming.ready();
    const order = settlementOrder(incoming.closed, permission);
    await stream.return?.();
    await pending;
    // An outstanding call prevents another permission; closure becomes observable without draining either Promise.
    await expect
      .poll(
        () =>
          incoming.ready().then(
            () => "ready",
            (error) => error.code
          ),
        {timeout: 5000}
      )
      .toBe("NetworkIncomingClosed");
    await expect(drainUntil(pair.right, permission)).rejects.toMatchObject({
      code: "NetworkIncomingClosed",
    });
    expect(order).toEqual(["closed", "NetworkIncomingClosed"]);
  } finally {
    holdSettling(pair.right, false);
    await Promise.all([pair.left.stop(), pair.right.close()]);
  }
}, 20000);

test("an acknowledgement due with the stream's close arrives in one completion and settles first", async () => {
  const pair = await incomingPair();
  holdSettling(pair.right, true);
  try {
    const stream = pair.left.request(pair.remote.peerId, BLOCKS, new Uint8Array(32));
    const first = stream.next();
    const incoming = await takeIncoming(pair.right);
    const data = new Uint8Array(4000).fill(23);
    const responded = incoming.respond(data, requestForks[0]);
    const order = settlementOrder(incoming.closed, responded);
    // End the stream before an exchange delivers the response acknowledgement.
    expect((await first).value?.data).toEqual(data);
    await stream.return?.();
    // An outstanding call prevents another permission; closure becomes observable without draining either Promise.
    await expect
      .poll(
        () =>
          incoming.ready().then(
            () => "ready",
            (error) => error.code
          ),
        {timeout: 5000}
      )
      .toBe("NetworkIncomingClosed");
    await drainUntil(pair.right, responded);
    await incoming.closed;
    expect(order).toEqual(["pending", "closed"]);
  } finally {
    holdSettling(pair.right, false);
    await Promise.all([pair.left.stop(), pair.right.close()]);
  }
}, 20000);

test("a response held in native borrow while its stream is cancelled and the network closes settles once, before the close", async () => {
  const pair = await incomingPair();
  try {
    // Two roots allow two chunks. The client's host holds the first, so the client reads no further, and the second,
    // incompressible and larger than the client's stream window, stays borrowed by the server's write until the
    // client pulls again, which it never does.

    const stream = pair.left.request(pair.remote.peerId, BLOCKS, new Uint8Array(64));
    const first = stream.next();
    const incoming = await takeIncoming(pair.right);
    await incoming.respond(new Uint8Array(4000).fill(1), requestForks[0]);
    expect((await first).done).toBe(false);
    const held = incoming.respond(incompressible(10 * 1024 * 1024, 71), requestForks[0]);
    const order = settlementOrder(incoming.closed, held);
    // Each command runs in a later owner turn than the one before it, so the second follows the turn that started the
    // write.
    await pair.right.reStatusPeers([]);
    await pair.right.reStatusPeers([]);

    expect(order).toEqual([]);
    const cancelled = incoming.cancel();
    const closing = pair.right.close();
    const outcome = await held.then(
      () => "sent",
      (error) => error.code
    );
    expect(["NetworkIncomingFailed", "NetworkClosed"]).toContain(outcome);
    expect(await cancelled).toBeUndefined();
    expect(await closing).toEqual({reason: "requested"});
    expect(order).toEqual([outcome, "closed"]);

    await stream.return?.();
  } finally {
    await Promise.all([pair.left.stop(), pair.right.close()]);
  }
}, 20000);
