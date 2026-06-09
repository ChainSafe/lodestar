import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {blsBatch} from "@chainsafe/lodestar-z/bls-batch";
import {SecretKey, Signature} from "@chainsafe/lodestar-z/blst";
import {getEmptyLogger} from "@lodestar/logger/empty";
import {ISignatureSet, SignatureSetType, getPubkeyCache} from "@lodestar/state-transition";
import {BlsVerifier} from "../../../../src/chain/bls/blsVerifier.js";
import {createMetricsTest} from "../../metrics/utils.js";

describe("BlsVerifier ", () => {
  const numKeys = 3;
  const secretKeys = Array.from({length: numKeys}, (_, i) => SecretKey.fromKeygen(Buffer.alloc(32, i)));
  // Use the native pubkey cache so blsBatch can resolve pubkeys by index
  const pubkeyCache = getPubkeyCache();
  for (const [i, sk] of secretKeys.entries()) {
    pubkeyCache.set(i, sk.toPublicKey().toBytes());
  }

  const verifier = new BlsVerifier(null, getEmptyLogger());

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("verifySignatureSets", () => {
    let sets: ISignatureSet[];

    beforeEach(() => {
      sets = secretKeys.map((secretKey, i) => {
        const signingRoot = Buffer.alloc(32, i);
        return {
          type: SignatureSetType.single,
          pubkey: secretKey.toPublicKey(),
          signingRoot,
          signature: secretKey.sign(signingRoot).toBytes(),
        };
      });
    });

    it("should verify all signatures", async () => {
      expect(await verifier.verifySignatureSets(sets)).toBe(true);
    });

    it("should return false if at least one signature is invalid", async () => {
      sets[1].signingRoot = Buffer.alloc(32, 10);
      expect(await verifier.verifySignatureSets(sets)).toBe(false);
    });

    it("should return false if at least one signature is malformed", async () => {
      const malformedSignature = Buffer.alloc(96, 10);
      expect(() => Signature.fromBytes(malformedSignature, true, true)).toThrow();
      sets[1].signature = malformedSignature;
      expect(await verifier.verifySignatureSets(sets)).toBe(false);
    });

    it("delegates backpressure to native blsBatch", () => {
      vi.spyOn(blsBatch, "canAcceptWork").mockReturnValue(false);

      expect(verifier.canAcceptWork()).toBe(false);
      expect(blsBatch.canAcceptWork).toHaveBeenCalled();
    });
  });

  describe("verifySignatureSetsSameMessage", () => {
    let sets: {index: number; signature: Uint8Array}[];
    const signingRoot = Buffer.alloc(32, 100);

    beforeEach(() => {
      sets = secretKeys.map((secretKey, i) => ({
        index: i,
        signature: secretKey.sign(signingRoot).toBytes(),
      }));
    });

    it("should verify all signatures", async () => {
      expect(await verifier.verifySignatureSetsSameMessage(sets, signingRoot)).toEqual([true, true, true]);
    });

    it("should return false for invalid signature", async () => {
      sets[1].signature = secretKeys[1].sign(Buffer.alloc(32)).toBytes();
      expect(await verifier.verifySignatureSetsSameMessage(sets, signingRoot)).toEqual([true, false, true]);
    });

    it("should return false for malformed signature", async () => {
      const malformedSignature = Buffer.alloc(96, 10);
      expect(() => Signature.fromBytes(malformedSignature, true, true)).toThrow();
      sets[1].signature = malformedSignature;
      expect(await verifier.verifySignatureSetsSameMessage(sets, signingRoot)).toEqual([true, false, true]);
    });
  });

  // A single bucket larger than the native 128-set per-job cap must be chunked,
  // otherwise the native `TooManySets` error is swallowed and valid signatures
  // (e.g. a maximally packed block) are reported invalid.
  describe("chunking (> MAX_SETS_PER_JOB)", () => {
    const n = 129; // one more than the native 128-set cap
    const sks = Array.from({length: n}, (_, i) => SecretKey.fromKeygen(Buffer.alloc(32, i)));
    // Populate the native pubkey cache so the same-message path can resolve indices
    for (let i = 0; i < n; i++) {
      pubkeyCache.set(i, sks[i].toPublicKey().toBytes());
    }

    function makeSingleSets(): ISignatureSet[] {
      return sks.map((sk, i) => {
        const signingRoot = Buffer.alloc(32, i);
        return {
          type: SignatureSetType.single,
          pubkey: sk.toPublicKey(),
          signingRoot,
          signature: sk.sign(signingRoot).toBytes(),
        };
      });
    }

    it("verifies > 128 valid sets async", async () => {
      expect(await verifier.verifySignatureSets(makeSingleSets())).toBe(true);
    });

    it("verifies > 128 valid sets on the main thread", async () => {
      expect(await verifier.verifySignatureSets(makeSingleSets(), {verifyOnMainThread: true})).toBe(true);
    });

    it("returns false when a set past the chunk boundary is invalid", async () => {
      const sets = makeSingleSets();
      sets[128].signingRoot = Buffer.alloc(32, 200); // wrong message for the 129th set
      expect(await verifier.verifySignatureSets(sets)).toBe(false);
      expect(await verifier.verifySignatureSets(sets, {verifyOnMainThread: true})).toBe(false);
    });

    it("verifies > 128 same-message sets", async () => {
      const signingRoot = Buffer.alloc(32, 123);
      const sets = sks.map((sk, i) => ({index: i, signature: sk.sign(signingRoot).toBytes()}));
      const results = await verifier.verifySignatureSetsSameMessage(sets, signingRoot);
      expect(results).toHaveLength(n);
      expect(results.every((r) => r)).toBe(true);
    });

    it("isolates an invalid set past the chunk boundary among same-message sets", async () => {
      const signingRoot = Buffer.alloc(32, 124);
      const sets = sks.map((sk, i) => ({index: i, signature: sk.sign(signingRoot).toBytes()}));
      sets[128].signature = sks[128].sign(Buffer.alloc(32, 1)).toBytes(); // wrong message
      const results = await verifier.verifySignatureSetsSameMessage(sets, signingRoot);
      expect(results[128]).toBe(false);
      expect(results.filter((r) => r)).toHaveLength(n - 1);
    });
  });

  // Operational failures (pool exhausted, shutdown, ...) must NOT be reported as an
  // invalid signature (`false`), which would wrongly REJECT gossip / mark valid blocks
  // invalid. They are rethrown; genuine bad-input errors still return `false`.
  describe("operational vs verification errors", () => {
    let sets: ISignatureSet[];
    const signingRoot = Buffer.alloc(32, 50);

    function blsError(code: string): Error {
      return Object.assign(new Error(`blsBatch: ${code}`), {code});
    }

    beforeEach(() => {
      sets = secretKeys.map((sk) => ({
        type: SignatureSetType.single,
        pubkey: sk.toPublicKey(),
        signingRoot,
        signature: sk.sign(signingRoot).toBytes(),
      }));
    });

    it("rethrows operational errors (async) instead of returning false", async () => {
      vi.spyOn(blsBatch, "asyncVerify").mockImplementation(() => {
        throw blsError("PoolExhausted");
      });
      await expect(verifier.verifySignatureSets(sets)).rejects.toMatchObject({code: "PoolExhausted"});
    });

    it("does not retry batchable jobs after native operational failure", async () => {
      const spy = vi.spyOn(blsBatch, "asyncVerify").mockImplementation(() => {
        throw blsError("PoolExhausted");
      });
      const manySets = Array.from({length: 32}, (_, i) => sets[i % sets.length]);

      await expect(verifier.verifySignatureSets(manySets, {batchable: true})).rejects.toMatchObject({
        code: "PoolExhausted",
      });
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("returns false (not throw) for genuine verification errors (async)", async () => {
      vi.spyOn(blsBatch, "asyncVerify").mockImplementation(() => {
        throw blsError("DeserializationFailed");
      });
      expect(await verifier.verifySignatureSets(sets)).toBe(false);
    });

    it("rethrows operational errors on the main thread", async () => {
      vi.spyOn(blsBatch, "verify").mockImplementation(() => {
        throw blsError("PoolShuttingDown");
      });
      await expect(verifier.verifySignatureSets(sets, {verifyOnMainThread: true})).rejects.toMatchObject({
        code: "PoolShuttingDown",
      });
    });

    it("rethrows operational errors in the same-message path", async () => {
      vi.spyOn(blsBatch, "asyncVerifySameMessage").mockImplementation(() => {
        throw blsError("PoolExhausted");
      });
      const smSets = secretKeys.map((sk, i) => ({index: i, signature: sk.sign(signingRoot).toBytes()}));
      await expect(verifier.verifySignatureSetsSameMessage(smSets, signingRoot)).rejects.toMatchObject({
        code: "PoolExhausted",
      });
    });
  });

  // Observability wiring: native blsBatch.stats() is sampled into saturation
  // gauges, and errored sig sets are counted by class. These are the metrics that
  // make the native verifier comparable apples-to-apples with the unstable pool.
  describe("metrics", () => {
    type MetricJson = {name: string; values: {value: number; labels: Record<string, string>}[]};
    // getMetricsAsJSON() is async and runs the registry collect callbacks
    // (including the addCollect that samples blsBatch.stats()), then returns values.
    const valuesOf = (arr: MetricJson[], name: string) => arr.find((m) => m.name === name)?.values;

    it("samples native worker-pool occupancy into gauges", async () => {
      const metrics = createMetricsTest();
      new BlsVerifier(metrics, getEmptyLogger());
      const arr = (await metrics.register.getMetricsAsJSON()) as MetricJson[];

      expect(valuesOf(arr, "lodestar_bls_verifier_workers_total")?.[0]?.value).toBeGreaterThan(0);
      // BlsVerifier sizes the native pool to maxInflightJobs = 1000.
      expect(valuesOf(arr, "lodestar_bls_verifier_max_inflight_jobs")?.[0]?.value).toBe(1000);
      // Saturation gauges reuse the legacy bls_thread_pool_* names (Option C). Idle: 0.
      expect(valuesOf(arr, "lodestar_bls_thread_pool_queue_length")?.[0]?.value).toBe(0);
      expect(valuesOf(arr, "lodestar_bls_thread_pool_workers_busy")?.[0]?.value).toBe(0);
    });

    it("counts operational errors by class and still rejects (no false verdict)", async () => {
      const metrics = createMetricsTest();
      const v = new BlsVerifier(metrics, getEmptyLogger());
      const sets: ISignatureSet[] = secretKeys.map((sk, i) => ({
        type: SignatureSetType.single,
        pubkey: sk.toPublicKey(),
        signingRoot: Buffer.alloc(32, i),
        signature: sk.sign(Buffer.alloc(32, i)).toBytes(),
      }));

      vi.spyOn(blsBatch, "asyncVerify").mockImplementation(() => {
        throw Object.assign(new Error("blsBatch: PoolExhausted"), {code: "PoolExhausted"});
      });

      await expect(v.verifySignatureSets(sets)).rejects.toMatchObject({code: "PoolExhausted"});

      const arr = (await metrics.register.getMetricsAsJSON()) as MetricJson[];
      // Legacy error name is UNLABELED (so the canonical error-ratio panel's vector
      // match still resolves); the operational/input breakdown is native-named.
      expect(
        valuesOf(arr, "lodestar_bls_thread_pool_error_jobs_signature_sets_count")?.[0]?.value
      ).toBeGreaterThanOrEqual(sets.length);
      const operational =
        valuesOf(arr, "lodestar_bls_verifier_errors_total")?.find((x) => x.labels.type === "operational")?.value ?? 0;
      expect(operational).toBeGreaterThanOrEqual(sets.length);
      // Admission-rejected (PoolExhausted) jobs must NOT be counted as "started".
      const startedDefault =
        valuesOf(arr, "lodestar_bls_thread_pool_jobs_started_total")?.find((x) => x.labels.type === "default")?.value ??
        0;
      expect(startedDefault).toBe(0);
    });

    it("counts aggregated pubkeys for aggregate-type sets under the legacy name", async () => {
      const metrics = createMetricsTest();
      const v = new BlsVerifier(metrics, getEmptyLogger());
      vi.spyOn(blsBatch, "asyncVerify").mockResolvedValue(true);
      const root = Buffer.alloc(32, 3);
      const sig = secretKeys[0].sign(root).toBytes();
      const sets: ISignatureSet[] = [
        {type: SignatureSetType.aggregate, indices: [0, 1, 2], signingRoot: root, signature: sig},
        {type: SignatureSetType.aggregate, indices: [0, 1], signingRoot: root, signature: sig},
      ];

      expect(await v.verifySignatureSets(sets)).toBe(true);

      const arr = (await metrics.register.getMetricsAsJSON()) as MetricJson[];
      expect(valuesOf(arr, "lodestar_bls_aggregated_pubkeys_total")?.[0]?.value).toBe(5); // 3 + 2
    });

    it("attributes errors/started per-chunk on a partial multi-chunk failure", async () => {
      const metrics = createMetricsTest();
      const v = new BlsVerifier(metrics, getEmptyLogger());
      const sk = secretKeys[0];
      const root = Buffer.alloc(32, 7);
      const one: ISignatureSet = {
        type: SignatureSetType.single,
        pubkey: sk.toPublicKey(),
        signingRoot: root,
        signature: sk.sign(root).toBytes(),
      };
      // 129 single sets -> 2 chunks: [128, 1]. asyncVerify is mocked, so set validity is moot.
      const sets = Array.from({length: 129}, () => one);
      const poolExhausted = Object.assign(new Error("blsBatch: PoolExhausted"), {code: "PoolExhausted"});
      vi.spyOn(blsBatch, "asyncVerify")
        .mockImplementationOnce(() => Promise.resolve(true)) // chunk 1 (128) admitted, true
        .mockImplementationOnce(() => {
          throw poolExhausted; // chunk 2 (1) fails at admission
        });

      await expect(v.verifySignatureSets(sets)).rejects.toMatchObject({code: "PoolExhausted"});
      await new Promise((r) => setImmediate(r)); // let chunk-1's success accounting settle

      const arr = (await metrics.register.getMetricsAsJSON()) as MetricJson[];
      // Only the FAILING chunk's 1 set is errored — not all 129.
      expect(valuesOf(arr, "lodestar_bls_thread_pool_error_jobs_signature_sets_count")?.[0]?.value).toBe(1);
      // Only the ADMITTED chunk counts as started/verified; the rejected chunk never started.
      expect(
        valuesOf(arr, "lodestar_bls_thread_pool_sig_sets_started_total")?.find((x) => x.labels.type === "default")
          ?.value
      ).toBe(128);
      expect(valuesOf(arr, "lodestar_bls_verifier_verified_sig_sets_total")?.[0]?.value).toBe(128);
    });

    it("emits reused throughput counters (sig_sets/started/success) under legacy names", async () => {
      const metrics = createMetricsTest();
      const v = new BlsVerifier(metrics, getEmptyLogger());
      const sets: ISignatureSet[] = secretKeys.map((sk, i) => ({
        type: SignatureSetType.single,
        pubkey: sk.toPublicKey(),
        signingRoot: Buffer.alloc(32, i),
        signature: sk.sign(Buffer.alloc(32, i)).toBytes(),
      }));

      expect(await v.verifySignatureSets(sets)).toBe(true);

      const arr = (await metrics.register.getMetricsAsJSON()) as MetricJson[];
      expect(valuesOf(arr, "lodestar_bls_thread_pool_sig_sets_total")?.[0]?.value).toBeGreaterThanOrEqual(sets.length);
      // True-verdict sets are native-named (NOT the legacy success_jobs, which counted
      // error-free completion incl. invalid-sig false).
      expect(valuesOf(arr, "lodestar_bls_verifier_verified_sig_sets_total")?.[0]?.value).toBeGreaterThanOrEqual(
        sets.length
      );
      const startedDefault =
        valuesOf(arr, "lodestar_bls_thread_pool_jobs_started_total")?.find((x) => x.labels.type === "default")?.value ??
        0;
      expect(startedDefault).toBeGreaterThanOrEqual(1);
    });

    it("reconstructs native latency histograms as _bucket{le}/_sum/_count under legacy names", async () => {
      const metrics = createMetricsTest();
      const v = new BlsVerifier(metrics, getEmptyLogger());
      const sets: ISignatureSet[] = secretKeys.map((sk, i) => ({
        type: SignatureSetType.single,
        pubkey: sk.toPublicKey(),
        signingRoot: Buffer.alloc(32, i),
        signature: sk.sign(Buffer.alloc(32, i)).toBytes(),
      }));

      // Async path dispatches a pool job; on completion the native queue-wait
      // histogram records one sample.
      expect(await v.verifySignatureSets(sets)).toBe(true);

      const arr = (await metrics.register.getMetricsAsJSON()) as MetricJson[];
      for (const base of [
        "lodestar_bls_thread_pool_queue_job_wait_time_seconds",
        "lodestar_bls_worker_thread_time_per_sigset_seconds",
      ]) {
        expect(valuesOf(arr, `${base}_count`)?.[0]?.value, base).toBeGreaterThanOrEqual(1);
        const buckets = valuesOf(arr, `${base}_bucket`) ?? [];
        // histogram_quantile() needs an +Inf bucket plus finite cumulative buckets.
        expect(buckets.find((x) => x.labels.le === "+Inf")?.value, base).toBeGreaterThanOrEqual(1);
        expect(
          buckets.some((x) => x.labels.le !== "+Inf"),
          base
        ).toBe(true);
      }
    });
  });
});
