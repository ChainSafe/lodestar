import type {Gauge} from "prom-client";
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {testLogger} from "@lodestar/logger/test-utils";
import {ISignatureSet, SignatureSetType} from "@lodestar/state-transition";
import {VerifySignatureOpts} from "../../../../src/chain/bls/interface.js";
import {BlsMultiThreadWorkerPool} from "../../../../src/chain/bls/multithread/index.js";
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

  it("Should not retry batchable jobs that fit the native verifier bound", async () => {
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
    const retries = await (metrics.blsThreadPool.batchRetries as unknown as Gauge).get();
    expect(retries.values[0]?.value).toBe(0);
  });

  it("Should dispatch bounded packages to idle workers", async () => {
    const pool = await initializePool();
    await new Promise((resolve) => setTimeout(resolve, 0));

    let startedWorkerCalls = 0;
    let releaseWorkers!: () => void;
    const workersReleased = new Promise<void>((resolve) => {
      releaseWorkers = resolve;
    });

    for (const worker of pool["workers"]) {
      if (!("workerApi" in worker.status)) {
        throw Error("BLS worker did not initialize");
      }

      const verifyManySignatureSets = worker.status.workerApi.verifyManySignatureSets.bind(worker.status.workerApi);
      worker.status.workerApi.verifyManySignatureSets = async (workReqs) => {
        startedWorkerCalls++;
        await workersReleased;
        return verifyManySignatureSets(workReqs);
      };
    }

    const smallJob = pool.verifySignatureSets([sets[0], sets[1]], {batchable: true});
    const largeJob = pool.verifySignatureSets(
      Array.from({length: 127}, () => sets[2]),
      {batchable: true}
    );

    try {
      await vi.waitFor(() => expect(startedWorkerCalls).toBe(2));
    } finally {
      releaseWorkers();
    }

    await expect(Promise.all([smallJob, largeJob])).resolves.toEqual([true, true]);
  });
});
