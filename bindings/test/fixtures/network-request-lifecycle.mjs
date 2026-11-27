import {startPeer} from "../utils/network-peer.js";
import {takeIncoming} from "../utils/network-incoming.js";
import assert from "node:assert/strict";
import {setTimeout as delay} from "node:timers/promises";

import {
  applicationConfig,
  localIntent,
  peerIdFromHex,
  requestForks,
  startRuntime,
  Settlements,
  topicName,
  unreachableConnect,
} from "../utils/network.js";
import {Child} from "../../../test/interop/child.mjs";

const mode = process.argv[2];
if (mode === "exit") {
  const leftConfig = applicationConfig();
  const rightConfig = applicationConfig();
  rightConfig.identitySecretKey[31] = 63;
  const left = startRuntime(leftConfig, () => undefined);
  const right = await startPeer(rightConfig);
  const [, remote] = await Promise.all([left.identity, right.identity]);
  await Promise.all([
    left.applyIntent(localIntent(leftConfig)),
    right.applyIntent(localIntent(rightConfig)),
  ]);
  await left.connect(remote.peerId, [remote.localEndpoint], 5000n);
  void left
    .request(remote.peerId, "/eth2/beacon_chain/req/beacon_blocks_by_root/2/ssz_snappy", new Uint8Array(32))
    .next()
    .catch(() => undefined);
  console.log("request-lifecycle", mode, "ok");
  process.exit(0);
}

if (mode === "pull-gc") {
  // A pending pull keeps its iterator alive, as a reaction to it would. Once it settles, the idle iterator is
  // collected, and its finalizer retires the request at both ends.
  const serverConfig = applicationConfig();
  serverConfig.identitySecretKey[31] = 63;
  const server = await startPeer(serverConfig);
  const config = applicationConfig();
  const runtime = startRuntime(config, () => undefined);
  const [, remote] = await Promise.all([runtime.identity, server.identity]);
  await Promise.all([
    runtime.applyIntent(localIntent(config)),
    server.applyIntent(localIntent(serverConfig)),
  ]);
  await runtime.connect(remote.peerId, [remote.localEndpoint], 5000n);
  let stream = runtime.request(
    remote.peerId,
    "/eth2/beacon_chain/req/beacon_blocks_by_root/2/ssz_snappy",
    new Uint8Array(32),
    {responseTimeoutMs: 60000}
  );
  const weak = new WeakRef(stream);
  const pulled = stream.next();
  stream = null;
  const incoming = await takeIncoming(server);
  for (let i = 0; i < 20; i++) {
    await delay(10);
    global.gc();
  }
  assert.notEqual(weak.deref(), undefined);

  await incoming.respond(new Uint8Array(4000).fill(9), requestForks[0]);
  assert.deepEqual((await pulled).value.data, new Uint8Array(4000).fill(9));
  for (let i = 0; i < 100; i++) {
    await delay(10);
    global.gc();
    if (!weak.deref()) break;
  }
  assert.equal(weak.deref(), undefined);

  await incoming.closed;
  await Promise.all([runtime.close(), server.stop()]);
  console.log("request-lifecycle", mode, "ok");
  process.exit(0);
}

if (["closed-facade-gc", "closed-facade-gc-early", "closed-terminal"].includes(mode)) {
  const config = applicationConfig();
  let runtime = startRuntime(config, () => undefined);
  const identity = await runtime.identity;
  await runtime.applyIntent(localIntent(config));
  const stream = runtime.request(
    identity.peerId,
    "/eth2/beacon_chain/req/beacon_blocks_by_root/2/ssz_snappy",
    new Uint8Array(32)
  );
  await runtime.close();
  if (mode !== "closed-facade-gc-early") await delay(500);
  if (mode === "closed-terminal") {
    await assert.rejects(stream.next(), {code: "NetworkClosed"});

  }
  const weak = new WeakRef(runtime);
  runtime = null;
  global.gc();
  for (let i = 0; i < 100; i++) {
    await delay(10);
    global.gc();
    if (!weak.deref()) break;
  }
  assert.equal(weak.deref(), undefined);
  if (mode.startsWith("closed-facade-gc")) await assert.rejects(stream.next(), {code: "NetworkClosed"});
  console.log("request-lifecycle", mode, "ok");
  process.exit(0);
}

/** A peer that holds requests without answering: the stock responder's hold scenario, else a native peer that never takes them. */
async function holdingPeer() {
  const host = process.env.LODESTAR_Z_NETWORK_STOCK_HOST;
  if (host) {
    const peer = new Child("lifecycle-stock", process.execPath, ["test/interop/request_responder.mjs", host]);
    const info = await peer.command("ready");
    await peer.command("scenario", {scenario: "hold"});
    const port = Number(info.address.split("/")[4]);
    return {id: peerIdFromHex(info.peer), endpoint: {family: 4, address: Uint8Array.of(127, 0, 0, 1), port}, peer};
  }
  const config = applicationConfig();
  config.identitySecretKey[31] = 63;
  const peer = await startPeer(config);
  await peer.applyIntent(localIntent(config));
  return {id: peer.identity.peerId, endpoint: peer.identity.localEndpoint, peer, native: peer};
}

const holding = await holdingPeer();
let runtime;
try {
  const config = applicationConfig();
  runtime = startRuntime(config, () => {
    throw Error("request-notifier");
  });
  await runtime.identity;
  await runtime.applyIntent(localIntent(config));
  const id = holding.id;
  await runtime.connect(id, [holding.endpoint], 5000n);
  let stream = runtime.request(id, "/eth2/beacon_chain/req/beacon_blocks_by_root/2/ssz_snappy", new Uint8Array(32), {
    responseTimeoutMs: 60000,
  });
  if (mode === "iterator-gc") {
    const incoming = holding.native ? await takeIncoming(holding.native) : undefined;
    const weak = new WeakRef(stream);
    stream = null;
    for (let i = 0; i < 100; i++) {
      await delay(10);
      global.gc();
      if (!weak.deref()) break;
    }
    assert.equal(weak.deref(), undefined);


    await incoming?.closed;
  } else {
    // Pending operations settle before close even after the caller drops its runtime reference.
    const closed = runtime.closed;
    const settlements = new Settlements();
    const unsettled = settlements.unsettledAtClose(closed);
    settlements.watch(() => stream.next());
    settlements.watch(() => runtime.connect(...unreachableConnect()));
    settlements.watch(() =>
      runtime.publishGossip(topicName(), new Uint8Array(4000), {allowZeroPeers: true, ignoreDuplicate: true})
    );
    const closing = runtime.close();
    runtime = null;
    global.gc();
    await closing;
    await settlements.settled();
    assert.deepEqual(await closed, {reason: "requested"});
    assert.deepEqual(await unsettled, []);
    assert.deepEqual(settlements.counts, [1, 1, 1]);
    assert.deepEqual(settlements.outcomes.slice(0, 2), ["NetworkClosed", "NetworkClosed"]);
    assert.deepEqual(await stream.next(), {done: true, value: undefined});
  }
  console.log("request-lifecycle", mode, "ok");
} finally {
  if (runtime) await runtime.close();
  await holding.peer.stop();
}
