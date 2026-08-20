import {afterEach, beforeAll, beforeEach, describe, expect, it} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {testLogger} from "@lodestar/logger/test-utils";
import {ISignatureSet, SignatureSetType} from "@lodestar/state-transition";
import {VerifySignatureOpts} from "../../../../src/chain/bls/interface.js";
import {BlsMultiThreadWorkerPool} from "../../../../src/chain/bls/multithread/index.js";
import {WorkResultCode} from "../../../../src/chain/bls/multithread/types.js";
import {createMetricsTest} from "../../../unit/metrics/utils.js";

describe("chain / bls / multithread queue", () => {
  const logger = testLogger();

  let controller: AbortController;
  const afterEachCallbacks: (() => Promise<void> | void)[] = [];
  const sets: ISignatureSet[] = [];
  const sameMessageSets: {index: number; signature: Uint8Array}[] = [];
  const sameMessage = Buffer.alloc(32, 100);

  beforeAll(() => {
    for (let i = 0; i < 3; i++) {
      const sk = SecretKey.fromBytes(Buffer.alloc(32, i + 1));
      const msg = Buffer.alloc(32, i + 1);
      const pk = sk.toPublicKey();
      const sig = sk.sign(msg);
      sets.push({
        type: SignatureSetType.single,
        pubkey: pk.toBytes(),
        signingRoot: msg,
        signature: sig.toBytes(),
      });
      const index = pubkeyCache.size;
      sameMessageSets.push({
        index,
        signature: sk.sign(sameMessage).toBytes(),
      });
      pubkeyCache.append(index, pk.toBytes());
    }
  });

  beforeEach(() => {
    controller = new AbortController();
  });

  afterEach(async () => {
    controller.abort();

    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  async function initializePool(): Promise<BlsMultiThreadWorkerPool> {
    const pool = new BlsMultiThreadWorkerPool({}, {logger, metrics: null});
    // await terminating all workers
    afterEachCallbacks.push(() => pool.close());
    // Wait until initialized
    await pool["waitTillInitialized"]();
    return pool;
  }

  async function testManyValidSignatures(
    testOpts: {sleep?: boolean},
    verifySignatureOpts?: VerifySignatureOpts
  ): Promise<void> {
    const pool = await initializePool();

    const isValidPromiseArr: Promise<boolean | boolean[]>[] = [];
    for (let i = 0; i < 8; i++) {
      isValidPromiseArr.push(pool.verifySignatureSets(sets, verifySignatureOpts));
      isValidPromiseArr.push(pool.verifySignatureSetsSameMessage(sameMessageSets, sameMessage, verifySignatureOpts));
      if (testOpts.sleep) {
        // Tick forward so the pool sends a job out
        await new Promise((r) => setTimeout(r, 5));
      }
    }

    const isValidArr = await Promise.all(isValidPromiseArr);
    for (const [i, isValid] of isValidArr.entries()) {
      if (i % 2 === 0) {
        expect(isValid).toBe(true);
      } else {
        expect(isValid).toEqual([true, true, true]);
      }
    }
    await pool.close();
  }

  for (const priority of [true, false]) {
    it(`Should verify multiple signatures submitted synchronously priority=${priority}`, async () => {
      // Given the `setTimeout(this.runJob, 0);` all sets should be verified in a single job an worker
      // when priority = true, jobs are executed in the reverse order
      await testManyValidSignatures({sleep: false}, {priority});
    });
  }

  it("Should record BLS scheduler and verification call metrics", async () => {
    const metrics = createMetricsTest();
    const pool = new BlsMultiThreadWorkerPool({}, {logger, metrics});
    afterEachCallbacks.push(() => pool.close());
    await pool["waitTillInitialized"]();

    await pool.verifySignatureSets(sets);
    await pool.verifySignatureSetsSameMessage(sameMessageSets, sameMessage);
    await pool.verifySignatureSets(sets, {batchable: true});

    const invalidSet: ISignatureSet = {...sets[0], signingRoot: Buffer.alloc(32, 0xff)};
    await pool.verifySignatureSets([invalidSet], {batchable: true});

    const batchSuccess = await metrics.register.getSingleMetricAsString(
      "lodestar_bls_thread_pool_batch_sigs_success_total"
    );
    expect(batchSuccess).toContain("lodestar_bls_thread_pool_batch_sigs_success_total 3");

    const verificationCallDuration = await metrics.register.getSingleMetricAsString(
      "lodestar_bls_thread_pool_verification_call_duration_seconds"
    );
    for (const operation of ["general_batch", "general_direct", "general_fallback", "same_message"]) {
      expect(verificationCallDuration).toContain(`operation="${operation}"`);
    }

    const verificationCallSignatureSets = await metrics.register.getSingleMetricAsString(
      "lodestar_bls_thread_pool_verification_call_signature_sets_total"
    );
    expect(verificationCallSignatureSets).toContain(
      'lodestar_bls_thread_pool_verification_call_signature_sets_total{operation="general_batch"} 4'
    );
    expect(verificationCallSignatureSets).toContain(
      'lodestar_bls_thread_pool_verification_call_signature_sets_total{operation="general_fallback"} 1'
    );

    const invalidInput: ISignatureSet = {...sets[0], type: SignatureSetType.aggregate, indices: [-1]};
    await expect(pool.verifySignatureSets([invalidInput])).rejects.toThrow("Invalid validator index -1");

    await Promise.all(Array.from({length: 11}, () => pool.verifySignatureSets(sets, {batchable: true})));

    const jobResults = await metrics.register.getSingleMetricAsString("lodestar_bls_thread_pool_job_results_total");
    expect(jobResults).toContain('type="default",outcome="valid"');
    expect(jobResults).toContain('type="default",outcome="invalid"');
    expect(jobResults).toContain('type="default",outcome="prepError"');
    expect(jobResults).toContain('type="same_message",outcome="valid"');

    const jobWaitTime = await metrics.register.getSingleMetricAsString(
      "lodestar_bls_thread_pool_queue_job_wait_time_seconds"
    );
    expect(jobWaitTime).toContain('lodestar_bls_thread_pool_queue_job_wait_time_seconds_count{type="default"}');
    expect(jobWaitTime).not.toContain("priority=");
    expect(jobWaitTime).not.toContain("batchable=");

    for (const [metricName, expectedUpperBound] of [
      ["lodestar_bls_thread_pool_queue_job_wait_time_seconds", 2],
      ["lodestar_bls_thread_pool_job_duration_seconds", 2],
      ["lodestar_bls_thread_pool_latency_to_worker", 0.1],
      ["lodestar_bls_thread_pool_latency_from_worker", 0.1],
      ["lodestar_bls_thread_pool_work_request_preparation_duration_seconds", 0.025],
      ["lodestar_bls_thread_pool_verification_call_duration_seconds", 0.5],
    ] as const) {
      const metric = await metrics.register.getSingleMetricAsString(metricName);
      const finiteBounds = [...metric.matchAll(/le="([^"]+)"/g)]
        .map((match) => Number(match[1]))
        .filter(Number.isFinite);
      expect(Math.max(...finiteBounds), `wrong upper bucket for ${metricName}`).toBe(expectedUpperBound);
    }

    const bufferFlushes = await metrics.register.getSingleMetricAsString(
      "lodestar_bls_thread_pool_buffer_flushes_total"
    );
    expect(bufferFlushes).toContain('reason="timeout"');
    expect(bufferFlushes).toContain('reason="size"');
  });

  it("Should distinguish verifier and worker result errors", async () => {
    const metrics = createMetricsTest();
    const pool = new BlsMultiThreadWorkerPool({}, {logger, metrics});
    afterEachCallbacks.push(() => pool.close());
    await pool["waitTillInitialized"]();

    for (const worker of pool["workers"]) {
      if (!("workerApi" in worker.status)) {
        throw Error("BLS worker did not initialize");
      }

      worker.status.workerApi.verifyManySignatureSets = async () => {
        const now = process.hrtime();
        return {
          workerId: 0,
          batchRetries: 0,
          batchSigsSuccess: 0,
          verificationCalls: [],
          workerStartTime: now,
          workerEndTime: now,
          results: [{code: WorkResultCode.error, error: Error("verification failed")}],
        };
      };
    }

    await expect(pool.verifySignatureSets([sets[0]])).rejects.toThrow("verification failed");

    for (const worker of pool["workers"]) {
      if (!("workerApi" in worker.status)) {
        throw Error("BLS worker did not initialize");
      }

      worker.status.workerApi.verifyManySignatureSets = async () => {
        const now = process.hrtime();
        return {
          workerId: 0,
          batchRetries: 0,
          batchSigsSuccess: 0,
          verificationCalls: [],
          workerStartTime: now,
          workerEndTime: now,
          results: [{code: WorkResultCode.success, result: []}],
        };
      };
    }

    await expect(pool.verifySignatureSets([sets[0]])).rejects.toThrow("Invalid BLS worker result length");

    const jobResults = await metrics.register.getSingleMetricAsString("lodestar_bls_thread_pool_job_results_total");
    expect(jobResults).toContain('type="default",outcome="verifyError"');
    expect(jobResults).toContain('type="default",outcome="workerError"');
  });

  for (const priority of [true, false]) {
    it(`Should verify multiple signatures submitted asynchronously priority=${priority}`, async () => {
      // Because of the sleep, each sets submitted should be verified in a different job and worker
      // when priority = true, jobs are executed in the reverse order
      await testManyValidSignatures({sleep: true}, {priority});
    });
  }

  for (const priority of [true, false]) {
    it(`Should verify multiple signatures batched pririty=${priority}`, async () => {
      // By setting batchable: true, 5*8 = 40 sig sets should be verified in one job, while 3*8=24 should
      // be verified in another job
      await testManyValidSignatures({sleep: true}, {batchable: true, priority});
    });
  }

  for (const priority of [true, false]) {
    it(`Should verify multiple signatures batched, first is invalid priority=${priority}`, async () => {
      // If the first signature is invalid it should not make the rest throw
      const pool = await initializePool();

      const invalidSet: ISignatureSet = {...sets[0], signature: Buffer.alloc(32, 0)};
      const isInvalidPromise = pool.verifySignatureSets([invalidSet], {batchable: true, priority});
      const isValidPromiseArr: Promise<boolean>[] = [];
      for (let i = 0; i < 8; i++) {
        isValidPromiseArr.push(pool.verifySignatureSets(sets, {batchable: true}));
      }

      expect(await isInvalidPromise).toBe(false);

      const isValidArr = await Promise.all(isValidPromiseArr);
      for (const [_, isValid] of isValidArr.entries()) {
        expect(isValid).toBe(true);
      }
      await pool.close();
    });
  }

  it("Should not retry batchable jobs that fit the verifier bound", async () => {
    const metrics = createMetricsTest();
    const pool = new BlsMultiThreadWorkerPool({}, {logger, metrics});
    afterEachCallbacks.push(() => pool.close());
    await pool["waitTillInitialized"]();

    const smallJob = pool.verifySignatureSets([sets[0], sets[1]], {batchable: true});
    const largeJob = pool.verifySignatureSets(
      Array.from({length: 255}, () => sets[2]),
      {batchable: true}
    );

    await expect(Promise.all([smallJob, largeJob])).resolves.toEqual([true, true]);
    const retries = await metrics.register.getSingleMetricAsString("lodestar_bls_thread_pool_batch_retries_total");
    expect(retries).toContain("lodestar_bls_thread_pool_batch_retries_total 0");
  });
});
