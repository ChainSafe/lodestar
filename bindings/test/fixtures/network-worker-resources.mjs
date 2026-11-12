import {startPeer} from "../utils/network-peer.js";
import {exchange, gossipAll, runtimeReleased, startRuntime} from "../utils/network.js";
import assert from "node:assert/strict";
import {createSocket} from "node:dgram";
import {once} from "node:events";
import {setTimeout as delay} from "node:timers/promises";
import {isMainThread, parentPort, Worker} from "node:worker_threads";

import {applicationConfig, localIntent, topicName} from "../utils/network.ts";

const topic = topicName();
const blocks = "/eth2/beacon_chain/req/beacon_blocks_by_root/2/ssz_snappy";
async function until(read) {
  for (let i = 0; i < 1000; i++) {
    const value = await read();
    if (value) return value;
    await delay(5);
  }
  throw Error("Live worker resources did not settle");
}
const config = applicationConfig();
config.identitySecretKey[31] = isMainThread ? 61 : 62;
config.resources.bridgeBudgetBytes = 512 * 1024 * 1024;
if (!isMainThread) {
  config.xray = {address: "/nonexistent-lodestar-xray-test/collector.sock", waitForAttach: false};
  config.resources.nativeBudgetBytes = 2 * 1024 ** 3;
}
const runtime = isMainThread ? await startPeer(config) : startRuntime(config);
const identity = await runtime.identity;
const intent = localIntent(config);
intent.coreTopics = true;
await runtime.applyIntent(intent);

if (!isMainThread) {
  parentPort.postMessage(identity);
  const [remote] = await once(parentPort, "message");
  const outgoing = runtime.request(remote.peerId, blocks, new Uint8Array(32));
  const pending = outgoing.next().catch(() => undefined);
  let incoming;
  let batch;
  await until(() => {
    const delivered = exchange(runtime, gossipAll);
    incoming ??= delivered.serving[0];
    batch ??= delivered.gossip;
    return incoming && batch;
  });
  assert.equal(batch.messages.length, 1);
  parentPort.postMessage({port: identity.localEndpoint.port});
  parentPort.on("message", () => void [incoming, outgoing, pending, batch]);
} else {
  const worker = new Worker(new URL(import.meta.url));
  try {
    const [remote] = await once(worker, "message");
    await runtime.connect(remote.peerId, [remote.localEndpoint], 5000n);
    await runtime.addDirectPeer(remote.peerId, [remote.localEndpoint]);
    const ready = once(worker, "message");
    worker.postMessage(identity);
    const outgoing = runtime.request(remote.peerId, blocks, new Uint8Array(32));
    const pending = outgoing.next().catch(() => undefined);
    const incoming = await until(() => runtime.takeIncomingRequest());
    await until(async () => (await runtime.getGossipDiagnostics()).peers.some((peer) => peer.outboundReady));
    await until(async () => {
      try {
        const payload = new Uint8Array(4000);
        new DataView(payload.buffer).setBigUint64(100, 100n, true);
        await runtime.publishGossip(topic, payload, {allowZeroPeers: false});
        return true;
      } catch (error) {
        if (error.reason === "no_peers_subscribed_to_topic") return false;
        throw error;
      }
    });
    const [held] = await ready;
    await worker.terminate();
    assert.deepEqual((await runtime.observeIdentity()).peerId, identity.peerId);
    const socket = createSocket("udp4");
    try {
      socket.bind(held.port, "127.0.0.1");
      await once(socket, "listening");
    } finally {
      socket.close();
    }
    assert.equal(incoming.peerId, remote.peerId);
    // Teardown with outstanding requests and pinned storage returned the worker runtime's process claim.
    await runtimeReleased();
    await startRuntime(applicationConfig()).close();
    await runtime.close();
    await pending;
    console.log("live-worker-resources-released");
  } finally {
    await worker.terminate();
    await runtime.stop();
  }
}
