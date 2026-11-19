import {once} from "node:events";
import {Worker} from "node:worker_threads";
import {expect, it} from "vitest";
import {gossipQueues} from "../src/gossip-queues.js";

it("shares ingress across environments and releases each claimed receipt once", async () => {
  const id = gossipQueues.create(1024, 64);
  try {
    const worker = new Worker(new URL("./fixtures/gossipIngress.ts", import.meta.url), {
      execArgv: ["--import", "tsx"],
      workerData: id,
    });
    const [[{wakes, workerQueue}], [code]] = await Promise.all([once(worker, "message"), once(worker, "exit")]);
    expect(code).toBe(0);
    expect(gossipQueues.offer(workerQueue, "voluntary_exit", 0, 0, "peer", "", new Uint8Array(), 0, 0)).toBe(false);
    expect(wakes).toEqual([true, ...Array(31).fill(false)]);

    const first = gossipQueues.drain(id, 0, false);
    expect(first.checks).toHaveLength(32);
    for (const check of first.checks) gossipQueues.classify(id, check.token, false);
    expect(gossipQueues.drain(id, 0, true).jobs).toHaveLength(0);
    gossipQueues.notify(id, new Uint8Array(32));
    const retry = gossipQueues.drain(id, 0, false);
    expect(retry.checks).toHaveLength(32);
    for (const check of retry.checks) gossipQueues.classify(id, check.token, true);
    expect(gossipQueues.drain(id, 0, false).jobs).toHaveLength(0);
    expect(gossipQueues.stats(id).beacon_attestation).toEqual({dropped: 0, executing: 0, keys: 1, queued: 32});
    const {jobs} = gossipQueues.drain(id, 0, true);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toHaveLength(32);
    expect(gossipQueues.stats(id).beacon_attestation).toEqual({dropped: 0, executing: 32, keys: 0, queued: 0});
    for (const message of jobs[0]) {
      expect(message.data[0], message.context).toBe(Number(message.context));
      expect(message.group, message.context).toEqual(new Uint8Array(128));
      expect(gossipQueues.complete(id, message.token), message.context).toBe(true);
      expect(gossipQueues.complete(id, message.token), message.context).toBe(false);
    }
  } finally {
    gossipQueues.close(id);
  }
});

it("closing a node invalidates its ingress id and outstanding claims", () => {
  const id = gossipQueues.create(1024, 1);
  const offer = () => gossipQueues.offer(id, "voluntary_exit", 0, 0, "peer", "original id", Uint8Array.of(1), 0, 0);
  try {
    expect(offer()).toBe(true);
    expect(gossipQueues.dump(id, "voluntary_exit")).toEqual([{context: "original id", data: Uint8Array.of(1)}]);
    const [job] = gossipQueues.drain(id, 0, true).jobs;
    gossipQueues.close(id);
    const other = gossipQueues.create(1024, 1);
    try {
      expect(other).not.toBe(id);
      expect(offer()).toBe(false);
      expect(gossipQueues.complete(id, job[0].token)).toBe(false);
      expect(gossipQueues.drain(other, 0, true).jobs).toEqual([]);
    } finally {
      gossipQueues.close(other);
    }
  } finally {
    gossipQueues.close(id);
  }
});
