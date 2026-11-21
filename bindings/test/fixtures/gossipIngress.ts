import assert from "node:assert/strict";
import {parentPort, workerData} from "node:worker_threads";
import {gossipQueues} from "../../src/gossip-queues.js";

assert(parentPort);
const id: number = workerData;
const data = new Uint8Array(240);
const peer = "libp2p-peer";
assert.throws(() => gossipQueues.checks(id, 0), /WrongGossipQueueOwner/);
assert.throws(() => gossipQueues.close(id), /WrongGossipQueueOwner/);
const wakes = Array.from({length: 32}, (_, i) => {
  data[0] = i;
  return gossipQueues.offer(id, "beacon_attestation", 5, 0, peer, String(i), data, 0, 0);
});
data.fill(255);
parentPort.postMessage({wakes, workerQueue: gossipQueues.create(1024, 1)});
