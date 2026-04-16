import path from "node:path";
import { Worker } from "node:worker_threads";
import { beforeAll, describe, expect, it } from "vitest";
import { PubkeyCache } from "@chainsafe/lodestar-z/pubkeys";
import { getPubkeyCache, syncPubkeys } from "../../../src/cache/pubkeyCache.js";
import { interopSecretKey } from "../../../src/util/interop.js";

/**
 * Tests for the global native pubkey cache (getPubkeyCache) with multithreaded access.
 *
 * In production, getPubkeyCache() and syncPubkeys() are called on the main thread
 * during beacon node startup. Worker threads (BLS verification, network core) then
 * read from the same native singleton. These tests verify that pattern: main thread
 * populates the cache, worker threads read it correctly.
 */

/* The type of task should match the pubkeyCache API.
 *
 * See: @chainsafe/lodestar-z/pubkeys
 */
type WorkerTaskType = Extract<keyof PubkeyCache, "get" | "getIndex" | "set" | "syncPubkeys";

interface WorkerTask {
  type: WorkerTaskType;
  indices?: number[];
  pubkeys?: string[];
  startIndex?: number;
  count?: number;
  totalCount?: number;
}

interface WorkerResult {
  type: WorkerTaskType;
  entries?: Record<number, string | null>;
  indexResults?: Record<string, number | null>;
  size?: number;
}

const workerPath = path.join(import.meta.dirname, "pubkeyCacheWorker.js");

function spawnWorker(): Worker {
  return new Worker(workerPath);
}

function sendTask(worker: Worker, task: WorkerTask): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.postMessage(task);
  })
}

function generatePubkeyHex(index: number): string {
  const sk = interopSecretKey(index);
  return Buffer.from(sk.toPublicKey().toBytes()).toString("hex");
}

describe("Global native pubkey cache - multithreaded access", () => {
  // Use high validator indices to avoid collisions with other tests that may
  // populate the global singleton at low indices
  const BASE_INDEX = 900_000;
  const COUNT = 20;

  beforeAll(() => {
    const cache = getPubkeyCache();
    for (let i = BASE_INDEX; i < BASE_INDEX + COUNT; i++) {
      const sk = interopSecretKey(i);
      cache.set(i, sk.toPublicKey().toBytes());
    }
  });

  it("worker thread can read pubkeys populated by main thread via get()", async () => {
    const indices = Array.from({ length: COUNT }, (_, i) => BASE_INDEX + i);

    const worker = spawnWorker();
    try {
      const result = await sendTask(worker, { type: "get", indices });

      for (const idx of indices) {
        const expected = generatePubkeyHex(idx);
        expect(result.entries?.[idx]).toBe(expected);
      }
    } finally {
      await worker.terminate();
    }
  });

  it("worker thread can reverse-lookup indices populated by main thread via getIndex()", async () => {
    const pubkeys: string[] = [];
    for (let i = BASE_INDEX; i < BASE_INDEX + COUNT; i++) {
      pubkeys.push(generatePubkeyHex(i));
    }

    const worker = spawnWorker();
    try {
      const result = await sendTask(worker, { type: "getIndex", pubkeys });

      for (let i = 0; i < COUNT; i++) {
        const expectedIndex = BASE_INDEX + i;
        expect(result.indexResults?.[pubkeys[i]]).toBe(expectedIndex);
      }
    } finally {
      await worker.terminate();
    }
  });

  it("worker thread sees correct cache size", async () => {
    const mainSize = getPubkeyCache().size;

    const worker = spawnWorker();
    try {
      const result = await sendTask(worker, { type: "get", indices: [] });
      expect(result.size).toBe(mainSize);
    } finally {
      await worker.terminate();
    }
  });

  it("multiple worker threads can read concurrently", async () => {
    const workersCount = 4;
    const indices = Array.from({ length: COUNT }, (_, i) => BASE_INDEX + i);

    const workers: Worker[] = [];
    try {
      const promises: Promise<WorkerResult>[] = [];
      for (let w = 0; w < workersCount; w++) {
        const worker = spawnWorker();
        workers.push(worker);
        promises.push(sendTask(worker, { type: "get", indices }));
      }

      const results = await Promise.all(promises);

      for (const result of results) {
        for (const idx of indices) {
          const expected = generatePubkeyHex(idx);
          expect(result.entries?.[idx]).toBe(expected);
        }
      }
    } finally {
      await Promise.all(workers.map((w) => w.terminate()));
    }
  });

  it("worker thread writes via set() are visible to main and other worker threads", async () => {
    const cache = getPubkeyCache();
    const startIndex = BASE_INDEX + 1000;
    const count = 10;

    const writer = spawnWorker();
    const reader = spawnWorker();
    try {
      await sendTask(writer, { type: "set", startIndex, count });

      const indices = Array.from({ length: count }, (_, i) => startIndex + i);

      // Verify from main thread — both get() and getIndex() directions
      for (const idx of indices) {
        const pk = cache.get(idx);
        expect(pk).toBeDefined();
        expect(Buffer.from(pk?.toBytes()).toString("hex")).toBe(generatePubkeyHex(idx));

        const sk = interopSecretKey(idx);
        expect(cache.getIndex(sk.toPublicKey().toBytes())).toBe(idx);
      }

      // Verify from a different worker thread
      const result = await sendTask(reader, { type: "get", indices });
      for (const idx of indices) {
        expect(result.entries?.[idx]).toBe(generatePubkeyHex(idx));
      }
    } finally {
      await Promise.all([writer.terminate(), reader.terminate()]);
    }
  });

  it("syncPubkeys on main thread makes new entries visible to workers", async () => {
    const cache = getPubkeyCache();
    const syncStart = cache.size;
    const syncCount = 10;

    // Build a validators array for syncPubkeys
    const validators: { pubkey: Uint8Array }[] = new Array(syncStart + syncCount);
    for (let i = syncStart; i < syncStart + syncCount; i++) {
      const sk = interopSecretKey(i);
      validators[i] = { pubkey: sk.toPublicKey().toBytes() };
    }
    syncPubkeys(cache, validators as any);

    // Worker should see the newly synced entries
    const indices = Array.from({ length: syncCount }, (_, i) => syncStart + i);
    const worker = spawnWorker();
    try {
      const result = await sendTask(worker, { type: "get", indices });

      for (const idx of indices) {
        const expected = generatePubkeyHex(idx);
        expect(result.entries?.[idx]).toBe(expected);
      }
    } finally {
      await worker.terminate();
    }
  });

  it("syncPubkeys from worker thread populates cache visible to main and other worker threads", async () => {
    const cache = getPubkeyCache();
    const currentSize = cache.size;
    const extraCount = 10;
    const totalCount = currentSize + extraCount;

    const writer = spawnWorker();
    const reader = spawnWorker();
    try {
      await sendTask(writer, { type: "syncPubkeys", totalCount });

      const indices = Array.from({ length: extraCount }, (_, i) => currentSize + i);

      // Verify from main thread
      for (const idx of indices) {
        const pk = cache.get(idx);
        expect(pk).toBeDefined();
        expect(Buffer.from(pk?.toBytes()).toString("hex")).toBe(generatePubkeyHex(idx));
      }

      // Verify from a different worker thread
      const result = await sendTask(reader, { type: "get", indices });
      for (const idx of indices) {
        expect(result.entries?.[idx]).toBe(generatePubkeyHex(idx));
      }
    } finally {
      await Promise.all([writer.terminate(), reader.terminate()]);
    }
  });
});
