import {randomFillSync} from "node:crypto";
import {once} from "node:events";
import {type Socket, createServer} from "node:net";
import {setTimeout as delay} from "node:timers/promises";
import {expect, test, vi} from "vitest";
import type {
  GossipJob,
  IncomingRequest,
  NativeApplicationConfig,
  NativeHost,
  NativeLogRecord,
  NativeNetwork,
  Verdict,
} from "../src/network.js";
import {
  applicationConfig,
  childTestTimeout,
  localIntent,
  metricValue,
  runChild,
  topicName,
  unreachableConnect,
  waitForGossipReady,
} from "./utils/network.js";
import {host} from "./utils/network-host.js";
import {BLOCKS} from "./utils/network-incoming.js";
import {type PeerRuntime, startPeer} from "./utils/network-peer.js";
import {createNativeNetwork, runtimeOf} from "./utils/network-runtime.js";

const TOPIC = topicName();

function blockPayload(byte: number): Uint8Array {
  const bytes = new Uint8Array(4000).fill(byte);
  new DataView(bytes.buffer).setBigUint64(100, 100n, true);
  return bytes;
}

/**
 * Starts the facade under test and `count` subprocess peers, each connected to the facade alone as a direct peer, all
 * subscribed to the block topic.
 */
async function facadeWithPeers(
  networkHost: NativeHost,
  count: number,
  configure: (config: NativeApplicationConfig, index: number) => void = () => undefined
) {
  const configs = Array.from({length: count + 1}, (_, index) => {
    const config = applicationConfig();
    config.identitySecretKey[31] = index + 1;
    configure(config, index);
    return config;
  });
  const peers: PeerRuntime[] = [];
  let network: NativeNetwork | undefined;
  try {
    for (const config of configs.slice(1)) peers.push(await startPeer(config));
    network = createNativeNetwork(configs[0], networkHost);
    const remote = await network.getIdentity();
    const intent = (config: NativeApplicationConfig) => ({...localIntent(config), coreTopics: true});
    await network.applyIntent(intent(configs[0]));
    for (const [i, peer] of peers.entries()) {
      const identity = await peer.identity;
      await peer.applyIntent(intent(configs[i + 1]));
      await peer.connect(remote.peerId, [remote.localEndpoint], 5000n);
      await Promise.all([
        peer.addDirectPeer(remote.peerId, [remote.localEndpoint]),
        network.setDirectPeer(identity.peerId, [identity.localEndpoint]),
      ]);
    }
    const identities = await Promise.all(peers.map((peer) => peer.identity));
    await Promise.all([
      waitForGossipReady(
        network,
        identities.map(({peerId}) => peerId),
        [TOPIC],
        network.metrics.bind(network)
      ),
      ...peers.map((peer) => waitForGossipReady(peer, [remote.peerId], [TOPIC], () => peer.getMetrics())),
    ]);
    return {network, peers, remote};
  } catch (error) {
    await Promise.allSettled([network?.close(), ...peers.map((peer) => peer.stop())]);
    throw error;
  }
}

/** Takes the next gossip messages a subprocess peer received, ignoring each, until `count` arrived. */
async function received(peer: PeerRuntime, count: number): Promise<number[]> {
  const bytes: number[] = [];
  for (let i = 0; i < 1000 && bytes.length < count; i++) {
    const {gossip} = await peer.exchange();
    for (const {handle} of gossip?.messages ?? []) await peer.reportGossip(handle, "ignore");
    bytes.push(...(gossip?.messages ?? []).map(({data}) => data[0]));
    if (!gossip) await delay(5);
  }
  return bytes;
}

test("native Xray exports while JavaScript is blocked and reconnects after idle collector closure", async () => {
  const sockets = new Set<Socket>();
  let attaches = 0;
  const collector = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => undefined);
    socket.on("close", () => sockets.delete(socket));
    socket.once("data", () => {
      attaches++;
      socket.write(Uint8Array.of(2, 4, 8, 3, 32, 1));
    });
    socket.on("data", () => undefined);
  });
  collector.listen(0, "127.0.0.1");
  await once(collector, "listening");
  const address = collector.address();
  if (!address || typeof address === "string") throw Error("Expected TCP collector");
  let fixture: Awaited<ReturnType<typeof facadeWithPeers>> | undefined;
  try {
    fixture = await facadeWithPeers(host(), 1, (config, index) => {
      if (index === 0) {
        config.xray = {address: `127.0.0.1:${address.port}`, waitForAttach: false};
        config.resources.nativeBudgetBytes = 2 * 1024 ** 3;
      }
    });
    const {network, peers} = fixture;
    await expect.poll(() => attaches).toBe(1);
    const before = metricValue(await network.metrics(), "lodestar_xray_sent_bytes_total") ?? 0;
    const payload = randomFillSync(blockPayload(0));
    new DataView(payload.buffer).setBigUint64(100, 100n, true);
    const sent = peers[0].publishGossip(TOPIC, payload, {allowZeroPeers: false});
    // The subprocess produces traffic while this environment cannot run callbacks or timers.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    expect(metricValue(await network.metrics(), "lodestar_xray_sent_bytes_total")).toBeGreaterThan(before + 4000);
    await sent;
    expect(metricValue(await network.metrics(), "lodestar_xray_dropped_bytes_total")).toBe(0);
    for (const socket of sockets) socket.destroy();
    await expect.poll(() => attaches, {timeout: 5000}).toBe(2);
  } finally {
    await fixture?.network.close();
    await Promise.all(fixture?.peers.map((peer) => peer.stop()) ?? []);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => collector.close(() => resolve()));
  }
}, 30_000);

test("validation returns before deferred handlers and only accepted messages are forwarded", async () => {
  const COUNT = 4;
  const verdictOf = (byte: number): Verdict => (byte === 1 ? "reject" : byte === 2 ? "ignore" : "accept");
  const accepted = [...Array(COUNT).keys()].filter((byte) => verdictOf(byte) === "accept");
  let network: NativeNetwork | undefined;
  const validated: number[] = [];
  const handled: number[] = [];
  const networkHost = host({
    validate(job: GossipJob) {
      const byte = job.messages[0].data[0];
      validated.push(byte);
      setImmediate(() => handled.push(byte));
      return Promise.resolve(job.messages.map(({data}) => verdictOf(data[0])));
    },
  });
  // The first peer publishes; the second receives what the facade forwards.
  const {network: facade, peers} = await facadeWithPeers(networkHost, 2);
  network = facade;
  const [publisher, receiver] = peers;
  try {
    for (let byte = 0; byte < COUNT; byte++)
      await publisher.publishGossip(TOPIC, blockPayload(byte), {allowZeroPeers: false});
    await vi.waitFor(() => expect(validated).toHaveLength(COUNT), {timeout: 10000});
    await vi.waitFor(() => expect(handled).toHaveLength(COUNT), {timeout: 10000});
    expect(validated.slice().sort((a, b) => a - b)).toEqual([...Array(COUNT).keys()]);
    expect(handled.slice().sort((a, b) => a - b)).toEqual([...Array(COUNT).keys()]);
    // Application admitted each accepted message, and no other, for forwarding.
    expect((await received(receiver, accepted.length)).sort((a, b) => a - b)).toEqual(accepted);
  } finally {
    await Promise.allSettled([network.close(), ...peers.map((peer) => peer.stop())]);
  }
}, 60000);

test("serving capacity stays charged after the stream closes until serve settles", async () => {
  let retire: () => void = () => undefined;
  const retired = new Promise<void>((resolve) => {
    retire = resolve;
  });
  let started: IncomingRequest | undefined;
  const networkHost = host({
    async serve(request) {
      started = request;
      await request.cancel();
      // Child work that outlives the stream.
      await retired;
    },
  });
  const {network, peers, remote} = await facadeWithPeers(networkHost, 1);
  const [client] = peers;
  try {
    const stream = client.request(remote.peerId, BLOCKS, new Uint8Array(32));
    const pending = stream.next().catch(() => undefined);
    await vi.waitFor(() => expect(started).toBeDefined(), {timeout: 5000});
    await pending;
    const retiring = async () => metricValue(await network.metrics(), "beacon_reqresp_retiring_count");
    await expect.poll(retiring, {timeout: 5000}).toBe(1);
    retire();
    await expect.poll(retiring, {timeout: 5000}).toBe(0);
  } finally {
    retire();
    await Promise.allSettled([network.close(), client.stop()]);
  }
}, 30000);

test("a serve that outlives the network's close retires quietly after it", async () => {
  let retire: () => void = () => undefined;
  const retired = new Promise<void>((resolve) => {
    retire = resolve;
  });
  let started: IncomingRequest | undefined;
  const errors: unknown[] = [];
  const networkHost = host({
    error: (error) => void errors.push(error),
    async serve(request) {
      started = request;
      await retired;
    },
  });
  const {network, peers, remote} = await facadeWithPeers(networkHost, 1);
  const [client] = peers;
  try {
    const stream = client.request(remote.peerId, BLOCKS, new Uint8Array(32));
    const pending = stream.next().catch(() => undefined);
    await vi.waitFor(() => expect(started).toBeDefined(), {timeout: 5000});
    // Close does not wait for the host's work, whose stream it ends.
    expect(await network.close()).toEqual({reason: "requested"});
    expect(await started?.closed).toBeUndefined();

    retire();
    await delay(20);
    expect(errors).toEqual([]);
    await pending;
  } finally {
    retire();
    await Promise.allSettled([network.close(), client.stop()]);
  }
}, 30000);

test.each(["after the host's cleanup", "racing a requested close"])(
  "a throwing peer handler fails the network %s",
  async (mode) => {
    const failure = new Error("peer handler failed");
    const config = applicationConfig();
    const peerConfig = applicationConfig();
    peerConfig.identitySecretKey[31] = 2;
    let network: NativeNetwork | undefined;
    let cleanup: Promise<unknown> | undefined;
    const failures: Error[] = [];
    const networkHost = host({
      failed(error) {
        failures.push(error);
        expect(error).toBe(failure);
        // Settlement continues while the host finishes cleanup.
        if (mode === "after the host's cleanup") cleanup = network?.getIdentity().finally(() => network?.close());
      },
      peers() {
        if (mode === "racing a requested close") void network?.close();
        throw failure;
      },
    });
    const peer = await startPeer(peerConfig);
    try {
      network = createNativeNetwork(config, networkHost);
      const remote = await network.getIdentity();
      await network.applyIntent(localIntent(config));
      await peer.applyIntent(localIntent(peerConfig));
      // The connection's first peer event reaches the throwing handler.
      await peer.connect(remote.peerId, [remote.localEndpoint], 5000n).catch(() => undefined);
      expect(await network.closed).toEqual({reason: "requested"});
      expect(failures).toEqual([failure]);
      if (mode === "after the host's cleanup") await expect(cleanup).resolves.toMatchObject({peerId: remote.peerId});
    } finally {
      await Promise.allSettled([network?.close(), peer.stop()]);
    }
  },
  30000
);

test.each([
  ["info", "info"],
  ["warn", "info"],
] as const)(
  "delivers native records at level %s, then at the level setLogLevel selects, through close",
  async (initial, selected) => {
    const config = applicationConfig();
    config.logLevel = initial;
    const records: NativeLogRecord[] = [];
    const network = createNativeNetwork(config, host({logs: (delivered) => void records.push(...delivered)}));
    let closedAt = -1;
    void network.closed.then(() => {
      closedAt = records.length;
    });
    try {
      await network.applyIntent(localIntent(config));
      await vi.waitFor(() => expect(records.length > 0 || initial !== "info").toBe(true), {timeout: 2000});
      await delay(300);
      const levels = new Set(records.map(({level}) => level));
      if (initial === "info") expect(records.some(({message}) => message.startsWith("owner_initialized "))).toBe(true);
      else expect([...levels].every((level) => level === "error" || level === "warn")).toBe(true);
      network.setLogLevel(selected);
    } finally {
      expect(await network.close()).toEqual({reason: "requested"});
    }
    // The last records, the owner's shutdown included, arrive before the close result.
    expect(records.slice(0, closedAt).some(({message}) => message.startsWith("owner_stopped reason=requested "))).toBe(
      true
    );
  },
  15000
);

test("capacity release wakes a bounded facade wait without retrying its rejected request", async () => {
  const config = applicationConfig();
  config.resources.bridgeBudgetBytes = 1024 * 1024 * 1024;
  const changed = vi.fn();
  const network = createNativeNetwork(config, host({requestCapacityChanged: changed}));
  try {
    await network.applyIntent(localIntent(config));
    const self = (await network.getIdentity()).peerId;
    const streams = Array.from({length: 32}, () => network.request(self, BLOCKS, new Uint8Array(32)));
    let refusal: unknown;
    try {
      network.request(self, BLOCKS, new Uint8Array(32));
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toMatchObject({
      capacityToken: expect.any(String),
      code: "NetworkRequestRejected",
      reason: "local_capacity",
    });
    const {capacityToken} = refusal as {capacityToken: string};
    expect(network.watchRequestCapacity(capacityToken)).toBe(false);
    network.stopDelivery();
    const wait = network.waitForRequestCapacity(capacityToken, {signal: new AbortController().signal, timeoutMs: 5000});
    const outcomes = await Promise.allSettled(streams.map((stream) => stream.next()));
    await wait;
    expect(changed).toHaveBeenCalled();
    expect(outcomes).toEqual(
      streams.map(() => ({reason: expect.objectContaining({reason: "disconnected"}), status: "rejected"}))
    );
    await expect(network.request(self, BLOCKS, new Uint8Array(32)).next()).rejects.toMatchObject({
      reason: "disconnected",
    });
  } finally {
    await network.close();
  }
}, 15000);

test("publication capacity release wakes the facade without retrying the refused payload", async () => {
  const config = applicationConfig();
  const network = createNativeNetwork(config, host());
  try {
    await network.applyIntent(localIntent(config));
    const topic = topicName("sync_committee_0");
    const data = new Uint8Array(144);
    const options = {allowZeroPeers: true, ignoreDuplicate: true};
    const publications = Array.from({length: 240}, () => network.publish(topic, data, options));
    const completed = Promise.all(publications);
    const refusal = await network.publish(topic, data, options).catch((error) => error);
    expect(refusal).toMatchObject({
      capacityToken: expect.any(String),
      code: "NetworkGossipPublishFailed",
      reason: "admission_full",
    });
    await network.waitForPublicationCapacity(refusal.capacityToken, {
      signal: new AbortController().signal,
      timeoutMs: 5000,
    });
    await completed;
    await expect(network.publish(topic, data, options)).resolves.toMatchObject({duplicate: true});
  } finally {
    await network.close();
  }
});

test("refuses an invalid peer report or imported root with an ordinary throw before queueing it", async () => {
  const config = applicationConfig();
  const network = createNativeNetwork(config, host());
  try {
    const self = (await network.getIdentity()).peerId;
    const [peer] = unreachableConnect();
    for (const [report, code] of [
      [() => network.reportPeer("not-a-peer", "fatal"), "InvalidNetworkPeerId"],
      [() => network.reportPeer(`${peer}\0`, "fatal"), "InvalidNetworkPeerId"],
      [() => network.reportPeer(peer, "severe" as "fatal"), "InvalidNetworkAction"],
      [() => network.blockImported(new Uint8Array(31)), "InvalidNetworkBytes"],
      [() => network.blockImported([...new Uint8Array(32)] as unknown as Uint8Array), "InvalidNetworkBytes"],
    ] as const)
      expect(report).toThrow(code);
    // Valid input still reaches native, which ignores a penalty for an identity it does not know.
    network.reportPeer(peer, "fatal");
    network.blockImported(new Uint8Array(32));
    expect((await network.getIdentity()).peerId).toBe(self);
  } finally {
    expect(await network.close()).toEqual({reason: "requested"});
  }
});

test("queued block roots survive caller buffer reuse and transfer", childTestTimeout(), () => {
  const output = runChild(["--import", "tsx", "bindings/test/fixtures/network-block-imported.mjs"]);
  expect(output).toContain("queued roots survived buffer reuse and transfer");
});

test("construction returns before host callbacks start", async () => {
  const networkHost = host();
  const capacity = vi.spyOn(networkHost, "capacity");
  const network = createNativeNetwork(applicationConfig(), networkHost);
  try {
    expect(capacity).not.toHaveBeenCalled();
    await network.getPeerScores();
    expect(capacity).toHaveBeenCalled();
  } finally {
    await network.close();
  }
});

test.each(["close-validation", "close-batches"])("explicit close lifecycle: %s", childTestTimeout(), (mode) => {
  const output = runChild(["--import", "tsx", "--expose-gc", "bindings/test/fixtures/network-lifecycle.mjs", mode]);
  expect(output).toContain(`${mode}-settled`);
});

test("promise-returning operations reject admission failures without throwing", async () => {
  const network = createNativeNetwork(applicationConfig(), host());
  try {
    await expect(network.connect("invalid", [])).rejects.toThrow("InvalidNetworkPeerId");
    await expect(network.disconnect("invalid")).rejects.toThrow("InvalidNetworkPeerId");
    await expect(network.setDirectPeer("invalid", null)).rejects.toThrow("InvalidNetworkPeerId");
    await expect(network.reStatus(["invalid"])).rejects.toThrow("InvalidNetworkPeerId");
    await expect(network.getGossipDiagnostics(-1)).rejects.toThrow("InvalidNetworkInteger");
  } finally {
    const closing = network.close();
    await expect(network.getIdentity()).rejects.toThrow("NetworkClosed");
    await expect(network.getDirectPeers()).rejects.toThrow("NetworkClosed");
    await closing;
  }
  await expect(network.getIdentity()).rejects.toThrow("NetworkClosed");
  await expect(network.getDirectPeers()).rejects.toThrow("NetworkClosed");
});

test("concurrent metrics scrapes share one owner command and reject after close", async () => {
  const network = createNativeNetwork(applicationConfig(), host());
  try {
    const first = network.metrics();
    const second = network.metrics();
    expect(second).toBe(first);
    const metrics = await first;
    expect(metrics).toContain("libp2p_peers 0\n");
    const families = [...metrics.matchAll(/^# TYPE (\S+) /gm)].map(([, name]) => name);
    expect(families).toContain("lodestar_network_drain_burst_seconds");
    expect(new Set(families).size).toBe(families.length);
    expect(await second).toBe(metrics);
    await network.close();
    await expect(network.metrics()).rejects.toThrow("NetworkClosed");
  } finally {
    await network.close();
  }
});

test("command pressure waits for admission, copies queued input and preserves direct membership order", async () => {
  const network = createNativeNetwork(applicationConfig(), host());
  try {
    const queries = Array.from({length: 80}, () => network.getPeerScores());
    const [peer, endpoints] = unreachableConnect();
    const added = network.setDirectPeer(peer, endpoints);
    endpoints[0].port = 0;
    const removed = network.setDirectPeer(peer, null);
    await Promise.all(queries);
    await added;
    expect(await removed).toBe(true);
    expect(await network.getDirectPeers()).toEqual([]);
  } finally {
    await network.close();
  }
});

test("close rejects commands waiting outside native", async () => {
  const network = createNativeNetwork(applicationConfig(), host());
  const outcomes = Array.from({length: 80}, () => network.getPeerScores().catch((error) => error.code));
  await network.close();
  const results = await Promise.all(outcomes);
  expect(results.slice(31)).toEqual(Array(49).fill("NetworkClosed"));
});

test("disconnect cancels a connect waiting behind native's dial allowance", async () => {
  const network = createNativeNetwork(applicationConfig(), host());
  const [peer, endpoints] = unreachableConnect();
  try {
    const admitted = Array.from({length: 16}, () => network.connect(peer, endpoints).catch(() => undefined));
    const waiting = network.connect(peer, endpoints).catch((error) => error.code);
    const disconnected = network.disconnect(peer);
    expect(await waiting).toBe("NetworkConnectCancelled");
    await disconnected;
    await Promise.all(admitted);
  } finally {
    await network.close();
  }
});

test("direct membership follows command order even when native settles reused cells out of order", async () => {
  const network = createNativeNetwork(applicationConfig(), host());
  try {
    const native = runtimeOf(network);
    if (!native) throw Error("Missing native runtime");
    await native.getMetrics();
    const [peer, endpoints] = unreachableConnect();
    const added = network.setDirectPeer(peer, endpoints);
    const removed = network.setDirectPeer(peer, null);
    expect(await network.getDirectPeers()).toEqual([]);
    expect(await added).toBeUndefined();
    expect(await removed).toBe(true);
    expect(await network.getDirectPeers()).toEqual([]);
    await network.setDirectPeer(peer, endpoints);
    const saved = await network.getDirectPeers();
    await network.setDirectPeer(peer, null);
    expect(saved).toEqual([peer]);
    const self = await network.getIdentity();
    await expect(network.setDirectPeer(self.peerId, endpoints)).rejects.toThrow("SelfDial");
    expect(await network.getDirectPeers()).toEqual([]);
  } finally {
    await network.close();
  }
});
