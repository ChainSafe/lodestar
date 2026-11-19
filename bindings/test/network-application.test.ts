import {createSocket} from "node:dgram";
import {once} from "node:events";
import {setTimeout as delay} from "node:timers/promises";
import {privateKeyFromRaw} from "@libp2p/crypto/keys";
import {peerIdFromPublicKey} from "@libp2p/peer-id";
import {expect, test, vi} from "vitest";
import type {NativePeerObservation} from "../src/network.js";
import {
  applicationConfig,
  childTestTimeout,
  configureChain,
  discoveryConfig,
  exchange,
  gossipAll,
  localIntent,
  ownerStopped,
  runChild,
  settleOnly,
  startRuntime,
} from "./utils/network.js";
import {type PeerRuntime, startPeer} from "./utils/network-peer.js";

test("Status-only updates copy inputs and preserve advertisement and subscriptions across a head regression", async () => {
  const config = discoveryConfig();
  const other = applicationConfig();
  other.identitySecretKey[31] = 2;
  const a = startRuntime(config, () => undefined);
  let b: PeerRuntime | undefined;
  try {
    b = await startPeer(other);
    const [identity] = await Promise.all([a.identity, b.identity]);
    const intent = localIntent(config);
    intent.coreTopics = true;
    await Promise.all([a.applyIntent(intent), b.applyIntent(localIntent(other))]);
    const topics = (await a.getGossipDiagnostics()).topics;
    const status = structuredClone(config.local.status);
    status.headSlot = 95n;
    status.headRoot.fill(7);
    const updated = a.updateStatus(status);
    status.headRoot.fill(9);
    await updated;
    await b.connect(identity.peerId, [identity.localEndpoint], 5000n);
    for (const headSlot of [95n, 90n]) {
      if (headSlot === 90n) {
        await a.updateStatus({...config.local.status, headRoot: new Uint8Array(32).fill(7), headSlot});
        await b.reStatusPeers([identity.peerId]);
      }
      let observed: Awaited<ReturnType<typeof b.observePeers>>["peers"][number]["status"] = null;
      for (let i = 0; i < 200; i++) {
        observed = (await b.observePeers()).peers.find((peer) => peer.identity === identity.peerId)?.status ?? null;
        if (observed?.headSlot === headSlot) break;
        await delay(10);
      }
      expect(observed?.headSlot).toBe(headSlot);
      expect(observed?.headRoot).toEqual(new Uint8Array(32).fill(7));

      expect((await a.getGossipDiagnostics()).topics).toEqual(topics);
      const current = await a.observeIdentity();
      expect(current.metadata).toEqual(identity.metadata);
      expect(current.localEnr).toEqual(identity.localEnr);
    }
  } finally {
    await Promise.all([a.close(), b?.stop()]);
  }
}, 15000);

test("Status-only validation uses the active fork and leaves rejected updates unpublished", async () => {
  const config = applicationConfig();
  configureChain(config, {ELECTRA_FORK_EPOCH: 0, FULU_FORK_EPOCH: 0});
  config.local.status.earliestAvailableSlot = 0n;
  const runtime = startRuntime(config, () => undefined);
  try {
    await runtime.identity;
    const intent = localIntent(config);
    await runtime.applyIntent(intent);
    for (const [field, value] of [
      ["headSlot", -1n],
      ["headSlot", 1n << 64n],
      ["headSlot", 100],
      ["headRoot", new Uint8Array(31)],
      ["forkDigest", new Uint8Array(5)],
      ["extra", true],
    ] as const) {
      const invalid = structuredClone(config.local.status);
      Reflect.set(invalid, field, value);
      expect(() => runtime.updateStatus(invalid)).toThrow();
    }
    await expect(runtime.updateStatus({...config.local.status, earliestAvailableSlot: null})).rejects.toThrow(
      "MissingAvailability"
    );
    await runtime.applyIntent(intent);
  } finally {
    await runtime.close();
  }
});

test("identity observations include accumulated queued updates", async () => {
  const config = applicationConfig();
  const runtime = startRuntime(config);
  try {
    const initial = await runtime.observeIdentity();

    const first = runtime.applyIntent({...localIntent(config), syncCommittees: [{subnet: 0, untilSlot: 200}]});
    const second = runtime.applyIntent({...localIntent(config), syncCommittees: [{subnet: 1, untilSlot: 200}]});
    expect(await runtime.observeIdentity()).toEqual(initial);

    await Promise.all([first, second]);
    const latest = await runtime.observeIdentity();
    expect(latest.metadata.syncnets).toBe(3);
    expect(latest.metadata.sequenceNumber).toBe(initial.metadata.sequenceNumber + 2n);
  } finally {
    await runtime.close();
  }
});

test("observations and command results survive a throwing notifier", async () => {
  const config = applicationConfig();
  let notifierCalls = 0;
  let callbackCommand: Promise<unknown> | undefined;
  const runtime = startRuntime(config, () => {
    notifierCalls++;
    callbackCommand ??= runtime.reStatusPeers([]);
    throw Error("notifier");
  });
  const other = applicationConfig();
  other.identitySecretKey[31] = 8;
  let remote: PeerRuntime | undefined;
  try {
    remote = await startPeer(other);
    const ready = await runtime.identity;
    const identity = await runtime.observeIdentity();
    expect(identity.peerId).toEqual(ready.peerId);
    await runtime.applyIntent(localIntent(config));
    const snapshot = await runtime.observePeers();
    expect(snapshot).toMatchObject({
      counts: {connected: 0, relevant: 0},
      peers: [],
    });
    expect(await runtime.removeDirectPeer(ready.peerId)).toBe(false);
    await runtime.disconnect(ready.peerId);
    await runtime.reStatusPeers([]);
    expect(exchange(runtime, {...gossipAll}).peers).toEqual([]);
    const remoteIdentity = await remote.identity;
    await remote.applyIntent(localIntent(other));
    const connected = runtime.connect(remoteIdentity.peerId, [remoteIdentity.localEndpoint], 5000n);
    await connected;
    for (let i = 0; i < 200 && notifierCalls === 0; i++) await delay(10);
    expect(notifierCalls).toBeGreaterThan(0);
    expect(callbackCommand).toBeDefined();
    await expect(callbackCommand).resolves.toBeUndefined();
  } finally {
    const close = runtime.close();
    expect(runtime.close()).toBe(close);
    await Promise.all([close, remote?.stop()]);
  }
}, 15000);

test("inline command inputs share cell capacity and unwind malformed input", async () => {
  const config = applicationConfig();
  const runtime = startRuntime(config, () => undefined);
  try {
    await runtime.identity;
    const one = runtime.applyIntent(localIntent(config));
    const two = runtime.applyIntent(localIntent(config));
    const three = runtime.applyIntent(localIntent(config));
    await Promise.all([one, two, three]);
    for (const malformed of [
      {coreTopics: 1},
      {attesters: new Array(129).fill({aggregators: 1n, slot: 100, subnets: 1n})},
    ]) {
      // @ts-expect-error Exercise malformed external input.
      await expect(runtime.applyIntent(malformed)).rejects.toThrow();
    }
    await runtime.applyIntent(localIntent(config));
    const pending = Array.from({length: 31}, () => runtime.getMetrics());
    expect(() => runtime.getMetrics()).toThrow("NetworkCommandFull");
    await Promise.all(pending);
  } finally {
    await runtime.close();
  }
});

test("actual 200/210 resources resolve and publish complete capacity", async () => {
  const config = applicationConfig();
  config.resources = {
    bridgeBudgetBytes: 512 * 1024 * 1024,
    maxPeers: 210,
    nativeBudgetBytes: 1024 * 1024 * 1024,
    receiveBudgetBytes: 512 * 1024 * 1024,
    targetPeers: 200,
  };
  const runtime = startRuntime(config, () => undefined);
  try {
    await runtime.identity;
    await runtime.applyIntent(localIntent(config));
    expect(runtime.limits.peerCapacity).toBe(Math.max(64, 2 * config.resources.maxPeers));
  } finally {
    await runtime.close();
  }
});

test("real authenticated connect, direct membership and generation-preserving immediate disconnect", async () => {
  const config = applicationConfig();
  const other = applicationConfig();
  other.identitySecretKey[31] = 2;
  const events: NativePeerObservation[] = [];
  const a = startRuntime(
    config,
    () => undefined,
    (batch) => events.push(...batch)
  );
  let b: PeerRuntime | undefined;
  try {
    b = await startPeer(other);
    const [identityA, identityB] = await Promise.all([a.identity, b.identity]);
    await Promise.all([a.applyIntent(localIntent(config)), b.applyIntent(localIntent(other))]);
    await a.connect(identityB.peerId, [identityB.localEndpoint], 5000n);
    await a.connect(identityB.peerId, [identityB.localEndpoint], 5000n);
    await a.addDirectPeer(identityB.peerId, [identityB.localEndpoint]);
    await a.reStatusPeers([identityB.peerId]);
    await vi.waitFor(async () => expect((await a.observePeers()).counts.connected).toBe(1));
    const before = await a.observePeers();
    expect(before.counts.connected).toBe(1);
    expect(before.peers[0].connection).not.toBeNull();
    expect(before.peers[0].redialUntilMs).toBe(0n);
    expect(before.peers[0].goodbyeUntilMs).toBe(0n);
    await a.disconnect(identityB.peerId);
    expect(await a.removeDirectPeer(identityB.peerId)).toBe(true);
    expect(await a.removeDirectPeer(identityB.peerId)).toBe(false);
    await vi.waitFor(() => expect(events.some((event) => event.type === "closed")).toBe(true));
    const closed = events.filter((event) => event.type === "closed");
    expect(closed).toHaveLength(1);
    expect(closed[0].connection).toEqual(before.peers[0].connection);
    expect(closed[0].identity).toEqual(before.peers[0].identity);
    expect(closed[0].reason).toBe("host");
    expect(identityA.peerId).not.toEqual(identityB.peerId);
  } finally {
    await Promise.all([a.close(), b?.stop()]);
  }
}, 15000);

test("connect timeout retains independently wanted direct membership", async () => {
  const config = applicationConfig();
  const other = applicationConfig();
  other.identitySecretKey[31] = 3;
  const a = startRuntime(config, () => undefined);
  const b = await silentPeer(other.identitySecretKey);
  try {
    await a.identity;
    const identity = await b.identity;
    await a.applyIntent(localIntent(config));
    await a.addDirectPeer(identity.peerId, [identity.localEndpoint]);
    await expect(a.connect(identity.peerId, [identity.localEndpoint], 30n)).rejects.toThrow("NetworkConnectTimeout");
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
});

test("peer penalties accumulate while the command lane is full", async () => {
  const first = applicationConfig();
  const second = applicationConfig();
  second.identitySecretKey[31] = 2;
  const a = startRuntime(first, () => undefined);
  let b: PeerRuntime | undefined;
  try {
    b = await startPeer(second);
    const [, remote] = await Promise.all([a.identity, b.identity]);
    await Promise.all([a.applyIntent(localIntent(first)), b.applyIntent(localIntent(second))]);
    await a.connect(remote.peerId, [remote.localEndpoint], 5000n);
    await vi.waitFor(async () => expect((await a.observePeers()).counts.connected).toBe(1));
    const observed = (await a.observePeers()).peers.find((peer) => peer.identity === remote.peerId);
    if (!observed?.connection) throw Error("Missing connected peer");
    const origin = {connection: observed.connection, endpoint: observed.endpoint};
    const pending = Array.from({length: 31}, () => a.getMetrics());
    expect(() => a.getMetrics()).toThrow("NetworkCommandFull");
    exchange(a, settleOnly, [
      {
        action: "high_tolerance",
        context: {origin, reason: "gossip_validation"},
        count: 3,
        peerId: remote.peerId,
        type: "reportPeer",
      },
    ]);
    await Promise.all(pending);
    let score = 0;
    for (let i = 0; i < 100; i++) {
      score = (await a.getPeerScores()).peers[0].score;
      if (score < -2.9) break;
      await delay(10);
    }
    expect(score).toBeLessThan(-2.9);
    expect(score).toBeGreaterThanOrEqual(-3);
    exchange(a, settleOnly, [
      {action: "fatal", count: 1, peerId: (await a.observeIdentity()).peerId, type: "reportPeer"},
    ]);
    expect((await a.observeIdentity()).peerId).toBe(a.identity.peerId);

    await a.disconnect(remote.peerId);
    exchange(a, settleOnly, [
      {
        action: "low_tolerance",
        context: {origin, reason: "gossip_import"},
        count: 1,
        peerId: remote.peerId,
        type: "reportPeer",
      },
    ]);
    for (let i = 0; i < 100; i++) {
      const retained = (await a.getPeerScores()).peers.find((peer) => peer.identity === remote.peerId);
      if (retained && retained.score < -12.9) break;
      await delay(10);
    }
    const retained = (await a.getPeerScores()).peers.find((peer) => peer.identity === remote.peerId);
    expect((await a.observePeers()).peers.some((peer) => peer.identity === remote.peerId)).toBe(false);
    expect(retained?.score).toBeLessThan(-12.9);
  } finally {
    await Promise.all([a.close(), b?.stop()]);
  }
}, 15000);

test("disconnect cancels pending one-shot connects and releases their dial intent", async () => {
  const config = applicationConfig();
  const other = applicationConfig();
  other.identitySecretKey[31] = 3;
  const a = startRuntime(config, () => undefined);
  let b: PeerRuntime | undefined;
  try {
    b = await startPeer(other);
    await a.identity;
    const identity = await b.identity;
    await a.applyIntent(localIntent(config));
    const pending = a.connect(identity.peerId, [identity.localEndpoint], 60000n).catch((error: Error) => error.message);
    await a.disconnect(identity.peerId);
    expect(await pending).toContain("NetworkConnectCancelled");
    await b.applyIntent(localIntent(other));
    await a.connect(identity.peerId, [identity.localEndpoint], 5000n);
    await vi.waitFor(async () => expect((await a.observePeers()).counts.connected).toBe(1));
    await a.disconnect(identity.peerId);
    await vi.waitFor(async () => expect((await a.observePeers()).counts.connected).toBe(0));
  } finally {
    await Promise.all([a.close(), b?.stop()]);
  }
}, 15000);

test("diagnostics share one buffer and the connect allowance rejects without partial admission", async () => {
  const config = applicationConfig();
  const remoteConfig = applicationConfig();
  remoteConfig.identitySecretKey[31] = 9;
  const runtime = startRuntime(config, () => undefined);
  const remote = await silentPeer(remoteConfig.identitySecretKey);
  try {
    await runtime.identity;
    const identity = await remote.identity;
    await runtime.applyIntent(localIntent(config));
    const diagnostic = runtime.getPeerScores();
    const gossip = runtime.getGossipDiagnostics();
    await Promise.all([diagnostic, gossip]);
    await Promise.all([runtime.reStatusPeers([]), runtime.reStatusPeers([]), runtime.reStatusPeers([])]);
    const connections = Array.from({length: 16}, () =>
      runtime.connect(identity.peerId, [identity.localEndpoint], 60000n).catch((error: Error) => error.message)
    );
    expect(() => runtime.connect(identity.peerId, [identity.localEndpoint], 60000n)).toThrow("NetworkCommandFull");

    const identityCommand = runtime.observeIdentity();
    await identityCommand;
    await runtime.close();
    expect(await Promise.all(connections)).toEqual(Array(16).fill("NetworkClosed"));
  } finally {
    await Promise.all([runtime.close(), remote.close()]);
  }
});

test("application exits after explicit close", childTestTimeout(), () => {
  const output = runChild(["--import", "tsx", "bindings/test/fixtures/network-application-lifecycle.mjs"]);
  expect(output).toContain("application-closed-exit");
});

test("identity reads the current signed ENR and copied intent ignores later input mutation", async () => {
  const config = applicationConfig();
  config.discovery = discoveryConfig().discovery;
  const runtime = startRuntime(config, () => undefined);
  try {
    const ready = await runtime.identity;
    expect(ready.localEnr).not.toBeNull();
    const intent = localIntent(config);
    intent.syncCommittees = [{subnet: 0, untilSlot: 200}];
    const applied = runtime.applyIntent(intent);
    intent.syncCommittees[0].subnet = 1;
    await applied;
    const first = await runtime.observeIdentity();
    expect(first.localEnr).not.toEqual(ready.localEnr);
    const repeated = localIntent(config);
    repeated.syncCommittees = [{subnet: 0, untilSlot: 200}];
    await runtime.applyIntent(repeated);
    expect((await runtime.observeIdentity()).localEnr).toEqual(first.localEnr);
  } finally {
    await runtime.close();
  }
});

test("incomplete early metadata rejects the whole intent without publishing local state", async () => {
  const config = applicationConfig();
  config.discovery = discoveryConfig().discovery;
  configureChain(config, {BLOB_SCHEDULE: [], FULU_FORK_EPOCH: Infinity});
  const runtime = startRuntime(config, () => undefined);
  try {
    await runtime.identity;
    await runtime.applyIntent(localIntent(config));
    const before = await runtime.observeIdentity();
    const intent = localIntent(config);
    intent.syncCommittees = [{subnet: 0, untilSlot: 200}];
    intent.custodyGroupCount = 0n;
    await expect(runtime.applyIntent(intent)).rejects.toThrow("InvalidCustodyCount");
    const after = await runtime.observeIdentity();
    expect(after.metadata).toEqual(before.metadata);
    expect(after.localEnr).toEqual(before.localEnr);
    await runtime.applyIntent(localIntent(config));
    intent.custodyGroupCount = 1n;
    await runtime.applyIntent(intent);
    expect((await runtime.observeIdentity()).metadata.syncnets).toBe(1);
  } finally {
    await runtime.close();
  }
});

test("graceful physical shutdown progresses while host callbacks are stalled", async () => {
  const config = applicationConfig();
  const other = applicationConfig();
  other.identitySecretKey[31] = 21;
  const a = startRuntime(config, () => undefined);
  let b: PeerRuntime | undefined;
  try {
    b = await startPeer(other);
    const [, identity] = await Promise.all([a.identity, b.identity]);
    await Promise.all([a.applyIntent(localIntent(config)), b.applyIntent(localIntent(other))]);
    await a.connect(identity.peerId, [identity.localEndpoint], 5000n);
    const closed = a.close();
    const wait = new Int32Array(new SharedArrayBuffer(4));
    let stopped = false;
    for (let i = 0; i < 800 && !stopped; i++) {
      stopped = ownerStopped(a);
      if (!stopped) Atomics.wait(wait, 0, 0, 10);
    }
    expect(stopped).toBe(true);

    expect(await closed).toEqual({reason: "requested"});
  } finally {
    await Promise.all([a.close(), b?.stop()]);
  }
}, 15000);

async function silentPeer(secret: Uint8Array) {
  const socket = createSocket("udp4");
  try {
    const listening = once(socket, "listening");
    socket.bind(0, "127.0.0.1");
    await listening;
    return {
      close: () => new Promise<void>((resolve) => socket.close(() => resolve())),
      identity: {
        localEndpoint: {address: Uint8Array.of(127, 0, 0, 1), family: 4 as const, port: socket.address().port},
        peerId: peerIdFromPublicKey(privateKeyFromRaw(secret).publicKey).toString(),
      },
    };
  } catch (error) {
    socket.close();
    throw error;
  }
}
