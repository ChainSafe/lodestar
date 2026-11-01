import {ownerStopped} from "../utils/network.js";
import assert from "node:assert/strict";
import {createSocket} from "node:dgram";
import {setTimeout as delay} from "node:timers/promises";
import {createNativeNetwork} from "../utils/network-runtime.js";
import {initializeNativeNetworkRuntime, runtimeOf} from "../utils/network-runtime.js";
import {
  applicationConfig,
  holdSettling,
  localIntent,
  runtimeReleased,
  Settlements,
  settleOnly,
  startRuntime,
  topicName,
  unreachableConnect,
  waitForGossipReady,
} from "../utils/network.js";

const mode = process.argv[2];
const noop = () => undefined;
if (mode === "open") {
  let network = createNativeNetwork(applicationConfig(), {
    subscribeCapacity: () => () => {},
    capacity: () => ({gossipValidation: "backpressured"}),
    validate: async () => [], checkDependencies: () => [], serve: (request) => request.cancel(),
    peers: noop, failed: noop, logs: noop,
  });
  const weak = new WeakRef(network);
  network = null;
  setTimeout(async () => {
    global.gc();
    const open = weak.deref();
    assert(open, "An open network owns its lifetime until close");
    assert.deepEqual(await open.close(), {reason: "requested"});
    console.log("open-until-close");
  }, 50).unref();
} else if (mode === "closed-gc") {
  let runtime = startRuntime(applicationConfig());
  const identity = runtime.identity;
  await runtime.close();
  const weak = new WeakRef(runtime);
  runtime = null;
  for (let i = 0; i < 100; i++) {
    await delay(10);
    global.gc();
    if (!weak.deref()) break;
  }
  assert.equal(weak.deref(), undefined, "A closed runtime must be collectible");
  await delay(20);
  const socket = createSocket("udp4");
  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(identity.localEndpoint.port, "127.0.0.1", resolve);
  });
  socket.close();
  await runtimeReleased();
  await startRuntime(applicationConfig()).close();
  console.log("closed-gc-rebound");
} else if (mode === "promises") {
  const config = applicationConfig();
  let runtime = startRuntime(config);
  const settlements = new Settlements();
  const unsettled = settlements.unsettledAtClose(runtime.closed);
  await runtime.applyIntent(localIntent(config));
  settlements.watch(() => runtime.connect(...unreachableConnect()));
  settlements.watch(() => runtime.reStatusPeers([]));
  for (let i = 0; i < 4; i++)
    settlements.watch(() =>
      runtime.publishGossip(topicName(), new Uint8Array(4000).fill(i), {allowZeroPeers: true, ignoreDuplicate: true})
    );
  const closing = runtime.close();
  runtime = null;
  await delay(1);
  global.gc();
  assert.equal((await closing).reason, "requested");
  await settlements.settled();
  assert.deepEqual(await unsettled, []);
  assert.deepEqual(settlements.counts, [1, 1, 1, 1, 1, 1]);
  assert.equal(settlements.outcomes[0], "NetworkClosed");
  console.log("promises-settled");
} else if (mode === "close-validation") {
  const {startPeer} = await import("../utils/network-peer.js");
  const config = applicationConfig();
  const remoteConfig = applicationConfig();
  remoteConfig.identitySecretKey[31] = 3;
  const remote = await startPeer(remoteConfig);
  const {promise: validation, resolve: validated} = Promise.withResolvers();
  const {promise: delivered, resolve: deliver} = Promise.withResolvers();
  let host = {
    network: null,
    subscribeCapacity: () => () => {},
    capacity: () => ({gossipValidation: "ready"}),
    validate() {
      deliver();
      return validation;
    },
    checkDependencies: (checks) => checks.map(() => false),
    serve: (request) => request.cancel(),
    peers: noop,
    failed: noop,
    logs: noop,
  };
  let network = createNativeNetwork(config, host);
  host.network = network;
  const intent = (value) => ({...localIntent(value), coreTopics: true});
  await network.applyIntent(intent(config));
  await remote.applyIntent(intent(remoteConfig));
  const [identity, remoteIdentity] = await Promise.all([network.getIdentity(), remote.identity]);
  await remote.connect(identity.peerId, [identity.localEndpoint], 5000n);
  await Promise.all([
    remote.addDirectPeer(identity.peerId, [identity.localEndpoint]),
    network.setDirectPeer(remoteIdentity.peerId, [remoteIdentity.localEndpoint]),
  ]);
  await Promise.all([
    waitForGossipReady(network, [remoteIdentity.peerId], [topicName()], () => network.metrics()),
    waitForGossipReady(remote, [identity.peerId], [topicName()], () => remote.getMetrics()),
  ]);
  const block = new Uint8Array(4000).fill(7);
  new DataView(block.buffer).setBigUint64(100, 100n, true);
  await remote.publishGossip(topicName(), block, {allowZeroPeers: false});
  await delivered;
  const closing = network.close();
  const weakNetwork = new WeakRef(network);
  const weakHost = new WeakRef(host);
  network = null;
  host = null;
  assert.deepEqual(await closing, {reason: "requested"});
  for (let i = 0; i < 100; i++) {
    await delay(10);
    global.gc();
    if (!weakNetwork.deref() && !weakHost.deref()) break;
  }
  assert.equal(weakNetwork.deref(), undefined);
  assert.equal(weakHost.deref(), undefined, "Pending validation must not retain a closed host");
  await runtimeReleased();
  validated(["accept"]);
  await remote.stop();
  console.log("close-validation-settled");
} else if (mode === "close-batches") {
  // No other I/O or timer keeps this process alive while the public pump drains several completion batches.
  const config = applicationConfig();
  config.resources.bridgeBudgetBytes = 512 * 1024 * 1024;
  config.resources.nativeBudgetBytes = 512 * 1024 * 1024;
  const settlements = new Settlements();
  const batches = [];
  function closePending() {
    const network = createNativeNetwork(config, {
      subscribeCapacity: () => () => {},
      capacity: () => ({gossipValidation: "backpressured"}),
      validate: async () => [],
      checkDependencies: (checks) => checks.map(() => false),
      serve: (request) => request.cancel(),
      peers: noop,
      failed: noop,
      logs: noop,
    });
    network.stopDelivery();
    const runtime = runtimeOf(network);
    const drain = runtime.exchange.bind(runtime);
    runtime.exchange = () => {
      const result = drain();
      batches.push(result);
      return result;
    };

    for (let i = 0; i < 100; i++)
      settlements.watch(() => network.publish(topicName(), new Uint8Array(4000), {allowZeroPeers: true}));
    return network.close();
  }
  const closing = closePending();
  global.gc();
  assert.deepEqual(await closing, {reason: "requested"});
  assert.deepEqual(settlements.counts, Array(100).fill(1));
  assert(batches.length >= 4);
  console.log("close-batches-settled");
} else if (mode === "saturated-close") {
  // Close begins with every family outstanding: each promise settles before closed, which leaves no cell, store or
  // event-loop hold, and a collected runtime makes way for the next one.
  const {incomingPair, takeIncoming, BLOCKS} = await import("../utils/network-incoming.js");
  let pair = await incomingPair();
  const {left, remote, identity} = pair;
  let right = pair.right;
  pair = null;
  const settlements = new Settlements();
  const unsettled = settlements.unsettledAtClose(right.closed);
  const served = [];
  for (let i = 0; i < 2; i++) {
    void left.request(remote.peerId, BLOCKS, new Uint8Array(32)).next().catch(noop);
    served.push(await takeIncoming(right));
  }
  settlements.watch(() => served[0].ready());
  for (const incoming of served) settlements.watch(() => incoming.closed);

  assert.throws(() => {
    for (let i = 0; i < 1024; i++) {
      const stream = right.request(identity.peerId, BLOCKS, new Uint8Array(32));
      settlements.watch(() => stream.next());
    }
  }, {code: "NetworkRequestRejected", reason: "local_capacity", capacityToken: /.+/});
  for (let i = 0; i < 16; i++) settlements.watch(() => right.reStatusPeers([]));
  for (let i = 0; i < 8; i++) settlements.watch(() => right.connect(...unreachableConnect()));
  for (let i = 0; i < 16; i++)
    settlements.watch(() =>
      right.publishGossip(topicName(), new Uint8Array(4000).fill(i), {allowZeroPeers: true, ignoreDuplicate: true})
    );
  assert.deepEqual(await right.close(), {reason: "requested"});
  await settlements.settled();
  assert.deepEqual(await unsettled, []);
  assert(settlements.counts.every((count) => count === 1));
  await left.stop();
  right = null;
  served.length = 0;
  await runtimeReleased();
  const next = startRuntime(applicationConfig());
  assert.equal(typeof (await next.observeIdentity()).peerId, "string");
  assert.deepEqual(await next.close(), {reason: "requested"});
  console.log("saturated-closed");
} else if (mode === "finalized-drain") {
  // Native's notifier finalizes while several batches of completions remain: the owner still delivers every one, then
  // the close.
  const config = applicationConfig();
  config.resources.bridgeBudgetBytes = 512 * 1024 * 1024;
  config.resources.nativeBudgetBytes = 512 * 1024 * 1024;
  const runtime = startRuntime(config);
  await runtime.applyIntent(localIntent(config));
  holdSettling(runtime, true);
  const settlements = new Settlements();
  const unsettled = settlements.unsettledAtClose(runtime.closed);
  for (let i = 0; i < 100; i++)
    settlements.watch(() =>
      runtime.publishGossip(topicName(), new Uint8Array(4000).fill(i), {allowZeroPeers: true, ignoreDuplicate: true})
    );
  for (let i = 0; i < 20; i++) settlements.watch(() => runtime.reStatusPeers([]));
  const closing = runtime.close();
  // The owner stops and releases the notifier, which finalizes while every completion waits for an exchange.
  let stopped = false;
    for (let i = 0; i < 400 && !stopped; i++) {
      stopped = ownerStopped(runtime);
      if (!stopped) await delay(5);
    }
    assert(stopped, "The owner must stop while delivery is held");
  await delay(50);
  assert(settlements.counts.every((count) => count === 0));
  holdSettling(runtime, false);
  assert.deepEqual(await closing, {reason: "requested"});
  await settlements.settled();
  assert.deepEqual(await unsettled, []);
  assert(settlements.counts.every((count) => count === 1));
  console.log("finalized-drained");
} else if (mode === "await-close") {
  // Only the notifier ref, taken by close, keeps the loop alive until closed settles.
  const config = applicationConfig();
  const runtime = startRuntime(config);
  await runtime.applyIntent(localIntent(config));
  assert.deepEqual(await runtime.close(), {reason: "requested"});
  console.log("close-awaited");
} else if (mode === "callback") {
  const {incomingPair, takeIncoming, BLOCKS} = await import("../utils/network-incoming.js");
  let calls = 0;
  const thrown = new Promise((resolve) =>
    process.on("uncaughtException", (error) => {
      assert.equal(error.message, "ordinary-work-notification-failure");
      resolve(error);
    })
  );
  const pair = await incomingPair(undefined, () => {
    calls++;
    throw new Error("ordinary-work-notification-failure");
  });
  try {
    const request = pair.left.request(pair.remote.peerId, BLOCKS, new Uint8Array(32));
    const response = request.next().catch(() => undefined);
    assert.equal((await thrown).message, "ordinary-work-notification-failure");
    const incoming = await takeIncoming(pair.right);
    await incoming.finish();
    await response;
    assert(calls > 0);
    console.log("callback-closed");
  } finally {
    await Promise.all([pair.left.stop(), pair.right.close()]);
  }
} else if (mode === "rearm") {
  // A notifier that throws before scheduling an exchange leaves nothing queued, so a later completion notifies again.
  process.on("uncaughtException", (error) => assert.equal(error.message, "notifier"));
  let notifications = 0;
  const config = applicationConfig();
  const runtime = initializeNativeNetworkRuntime(config, () => {
    notifications++;
    throw new Error("notifier");
  });
  const intent = runtime.applyIntent(localIntent(config));
  for (let i = 0; i < 200 && notifications === 0; i++) await delay(10);
  // Owner activity while it starts can notify again; an idle owner has none.
  await delay(100);
  const idle = notifications;
  assert(idle > 0);
  const command = runtime.reStatusPeers([]);
  for (let i = 0; i < 200 && notifications === idle; i++) await delay(10);
  assert(notifications > idle);
  let closed = false;
  void runtime.close().then(() => {
    closed = true;
  });
  for (let i = 0; i < 400 && !closed; i++) {
    runtime.setCapacity(settleOnly);
    runtime.exchange();
    await delay(5);
  }
  assert.equal(await intent, undefined);
  assert.equal(await command, undefined);
  console.log("rearmed");
} else throw new Error("Unknown lifecycle scenario");
