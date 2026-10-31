import crypto from "node:crypto";
import {Worker} from "node:worker_threads";
import {describe, expect, it} from "vitest";
import {PublicKey, SecretKey, Signature, verify} from "../src/blst.js";
import {pubkeyCache} from "../src/pubkeys.js";
import type {IsolationScenario} from "./fixtures/workerIsolation.js";

/**
 * Tests that the per-context instance data (blst InstanceData) and
 * refcounted shared state (pool, pubkeys, config) survive a worker
 * thread loading and unloading the bindings.
 *
 * Before the cleanup-hook + refcount refactor, a worker's env teardown
 * would have wiped shared module globals, corrupting the main thread.
 */
describe("worker isolation", () => {
  it("main thread blst operations survive a worker loading and unloading bindings", async () => {
    // 1. Do blst work on the main thread before the worker
    const sk = SecretKey.fromKeygen(crypto.randomBytes(32));
    const pk = sk.toPublicKey();
    const msg = crypto.randomBytes(32);
    const sig = sk.sign(msg);
    expect(verify(msg, pk, sig)).toBe(true);

    // 2. Spawn a worker that loads bindings, does blst work, then exits
    const workerResult = await runBlstWorker();
    expect(workerResult).toBe("ok");

    // 3. After the worker's env teardown + cleanup hooks have fired,
    //    verify main thread blst operations still work
    const sk2 = SecretKey.fromKeygen(crypto.randomBytes(32));
    const pk2 = sk2.toPublicKey();
    const msg2 = crypto.randomBytes(32);
    const sig2 = sk2.sign(msg2);
    expect(verify(msg2, pk2, sig2)).toBe(true);

    // Original keys should still work too
    expect(verify(msg, pk, sig)).toBe(true);
    expect(pk).toBeInstanceOf(PublicKey);
    expect(sig).toBeInstanceOf(Signature);
  });

  it("multiple sequential workers do not corrupt state", async () => {
    const sk = SecretKey.fromKeygen(crypto.randomBytes(32));
    const pk = sk.toPublicKey();
    const msg = crypto.randomBytes(32);
    const sig = sk.sign(msg);

    for (let i = 0; i < 3; i++) {
      const result = await runBlstWorker();
      expect(result).toBe("ok");

      // Main thread still works after each worker teardown
      expect(verify(msg, pk, sig)).toBe(true);
    }
  });

  it("shares cache reads with workers but restricts administration to the control environment", async () => {
    const ikm = new Uint8Array(32);
    ikm[0] = 1;
    const expected = SecretKey.fromKeygen(ikm).toPublicKey().toBytes();
    pubkeyCache.reset();
    pubkeyCache.append(0, expected);

    const result = await runWorker<{
      pubkey: Uint8Array;
      save: string | null;
      load: string | null;
      reset: string | null;
    }>("pubkeys");

    expect(result).toEqual({
      load: "PubkeyCacheControlEnvironmentOnly",
      pubkey: expected,
      reset: "PubkeyCacheControlEnvironmentOnly",
      save: "PubkeyCacheControlEnvironmentOnly",
    });
    expect(pubkeyCache.size).toBe(1);
    expect(pubkeyCache.getOrThrow(0).toBytes()).toEqual(expected);
  });
});

function runBlstWorker(): Promise<string> {
  return runWorker("blst");
}

function runWorker<T>(scenario: IsolationScenario): Promise<T> {
  return new Promise((resolve, reject) => {
    let received = false;
    let result: T;
    const worker = new Worker(new URL("./fixtures/workerIsolation.ts", import.meta.url), {
      execArgv: ["--import", "tsx"],
      workerData: scenario,
    });

    worker.on("message", (message: T) => {
      received = true;
      result = message;
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Worker exited with code ${code}`));
      } else if (!received) {
        reject(new Error("Worker exited without a result"));
      } else {
        resolve(result);
      }
    });
  });
}
