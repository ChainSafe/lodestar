import {expect, test} from "vitest";
import type {NativeLogRecord} from "../src/network.js";
import {applicationConfig, startRuntime} from "./utils/network.js";
import {BLOCKS, incomingPair, takeIncoming} from "./utils/network-incoming.js";
import {type PeerRuntime, startPeer} from "./utils/network-peer.js";
import type {NetworkTestRuntime} from "./utils/network-runtime.js";

async function drain(
  runtime: Pick<NetworkTestRuntime, "drainLogs"> | Pick<PeerRuntime, "drainLogs">
): Promise<NativeLogRecord[]> {
  const records: NativeLogRecord[] = [];
  for (let i = 0; i < 8; i++) {
    const batch = await runtime.drainLogs(256);
    records.push(...batch.records);
    if (!batch.more) return records;
  }
  throw Error("Unexpected log volume");
}

test("native std.log captures lifecycle, timestamps and isolated processes through close", async () => {
  const left = startRuntime(applicationConfig(), () => undefined);
  let right: PeerRuntime | undefined;
  try {
    right = await startPeer(applicationConfig());
    await Promise.all([left.close(), right.close()]);
    for (const runtime of [left, right]) {
      const records = await drain(runtime);
      expect(records.some((r) => r.message.startsWith("owner_initializing"))).toBe(true);
      expect(records.some((r) => r.message.startsWith("owner_initialized "))).toBe(true);
      expect(records.some((r) => r.message.startsWith("owner_stopped reason=requested "))).toBe(true);
      for (const record of records) {
        expect(record.timestampMs).toBeGreaterThan(Date.now() - 20000);
      }
      expect((await runtime.drainLogs()).records).toEqual([]);
    }
  } finally {
    await Promise.all([left.close(), right?.stop()]);
  }
}, 20000);

test("ReleaseSafe debug logs correlate real requests without draining request data", async () => {
  const pair = await incomingPair();
  try {
    const {waitFor} = await import("../../test/interop/child.mjs");
    // Startup control requests share the bounded req/resp log quota.
    await waitFor(async () => {
      const snapshots = await Promise.all([pair.left.observePeers(), pair.right.observePeers()]);
      return snapshots.every((snapshot) => snapshot.peers[0]?.status && snapshot.peers[0]?.metadata);
    });
    await pair.left.setLogLevel("debug");
    pair.right.setLogLevel("debug");
    await drain(pair.left);
    await drain(pair.right);
    const request = pair.left.request(pair.remote.peerId, BLOCKS, new Uint8Array(32).fill(7));
    const pending = request.next();
    void pending.catch(() => undefined);
    const incoming = await takeIncoming(pair.right);
    await incoming.finish();
    expect(await pending).toEqual({done: true, value: undefined});
    for (const runtime of [pair.left, pair.right]) {
      const allRecords = await drain(runtime);
      const records = allRecords.filter((r) => r.message.includes("method=blocks_by_root_v2"));
      const started = records.find((r) => r.message.startsWith("request_started "));
      const completed = records.find((r) => r.message.startsWith("request_completed "));
      expect(started).toBeDefined();
      expect(completed, allRecords.map((r) => r.message).join("\n")).toBeDefined();
      expect(started?.level).toBe("debug");
      for (const field of ["request", "connection"]) {
        const pattern = new RegExp(`\\b${field}=(\\d+:\\d+)\\b`);
        const startedId = started?.message.match(pattern)?.[1];
        const completedId = completed?.message.match(pattern)?.[1];
        expect(startedId, started?.message).toBeDefined();
        expect(completedId, completed?.message).toBeDefined();
        expect(startedId).toBe(completedId);
      }
    }
    const failed = pair.left.request(pair.remote.peerId, BLOCKS, new Uint8Array(32));
    const failedNext = failed.next();
    const rejected = expect(failedNext).rejects.toMatchObject({peerStatus: 2, reason: "peer_error"});
    const rejectedIncoming = await takeIncoming(pair.right);
    await rejectedIncoming.fail(2, new TextEncoder().encode("untrusted response text\nsecret"));
    await rejected;
    await rejectedIncoming.closed;
    const failures = (await drain(pair.left)).filter((r) => r.scope === "network_reqresp_errors");
    const failure = failures.find(
      (r) => r.message.startsWith("request_failed ") && r.message.includes("reason=peer_error ")
    );
    expect(failure?.message).toContain("detail=none ");
    expect(failure?.message).toContain("peer_code=2 ");
    const responses = (await drain(pair.right)).filter((r) => r.message.includes("method=blocks_by_root_v2"));
    const errorResponses = responses.filter((r) => r.message.startsWith("request_error_response "));
    expect(errorResponses).toHaveLength(1);
    expect(errorResponses[0].message).toContain("code=2 ");
    expect(responses.some((r) => r.message.startsWith("request_completed "))).toBe(false);
    expect(
      [...failures, ...responses].every(
        (r) => !r.message.includes("untrusted response text") && !r.message.includes("secret")
      )
    ).toBe(true);
  } finally {
    await Promise.all([pair.left.stop(), pair.right.close()]);
  }
}, 20000);

test("native logging rejects malformed controls and honors off", async () => {
  const runtime = startRuntime(applicationConfig(), () => undefined);
  try {
    await runtime.identity;
    for (const level of ["debug-extra", "info-extra", "error-extra", "", "trace", "DEBUG", "debug\0", null, 0]) {
      expect(() => Reflect.apply(runtime.setLogLevel, runtime, [level])).toThrow("InvalidNetworkLogLevel");
    }
    for (const limit of [0, -1, 257, 1.5, NaN, Infinity, "1", null]) {
      expect(() => Reflect.apply(runtime.drainLogs, runtime, [limit])).toThrow("InvalidDrainLimit");
    }
    runtime.setLogLevel("off");
    await drain(runtime);
    await runtime.close();
    expect(await drain(runtime)).toEqual([]);
  } finally {
    await runtime.close();
  }
});
