import {afterEach, beforeAll, beforeEach, describe, expect, it} from "vitest";
import {PublicKey, SecretKey, aggregateSignatures} from "@chainsafe/lodestar-z/blst";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {testLogger} from "@lodestar/logger/test-utils";
import {ISignatureSet, SignatureSetType} from "@lodestar/state-transition";
import {VerifySignatureOpts} from "../../../../src/chain/bls/interface.js";
import {BlsMultiThreadWorkerPool} from "../../../../src/chain/bls/multithread/index.js";

describe("chain / bls / multithread queue", () => {
  const logger = testLogger();

  let controller: AbortController;
  const afterEachCallbacks: (() => Promise<void> | void)[] = [];
  const sets: ISignatureSet[] = [];
  const sameMessageSets: {publicKey: PublicKey; signature: Uint8Array}[] = [];
  const sameMessage = Buffer.alloc(32, 100);
  // Base index of this file's keys in the process-wide native cache
  let baseIndex = 0;
  const workerResolvedSets: ISignatureSet[] = [];

  beforeAll(() => {
    baseIndex = pubkeyCache.size;
    const sks: SecretKey[] = [];
    for (let i = 0; i < 3; i++) {
      const sk = SecretKey.fromBytes(Buffer.alloc(32, i + 1));
      const msg = Buffer.alloc(32, i + 1);
      const pk = sk.toPublicKey();
      const sig = sk.sign(msg);
      sks.push(sk);
      sets.push({
        type: SignatureSetType.single,
        pubkey: pk,
        signingRoot: msg,
        signature: sig.toBytes(),
      });
      sameMessageSets.push({
        publicKey: pk,
        signature: sk.sign(sameMessage).toBytes(),
      });
      pubkeyCache.append(pubkeyCache.size, pk.toBytes());
    }

    // Indexed set: worker must resolve baseIndex+1 from the shared cache
    const indexedMsg = Buffer.alloc(32, 50);
    workerResolvedSets.push({
      type: SignatureSetType.indexed,
      index: baseIndex + 1,
      signingRoot: indexedMsg,
      signature: sks[1].sign(indexedMsg).toBytes(),
    });

    // Aggregate set: worker must sum baseIndex..baseIndex+2 from the shared cache
    const aggMsg = Buffer.alloc(32, 60);
    workerResolvedSets.push({
      type: SignatureSetType.aggregate,
      indices: [baseIndex, baseIndex + 1, baseIndex + 2],
      signingRoot: aggMsg,
      signature: aggregateSignatures(sks.map((sk) => sk.sign(aggMsg))).toBytes(),
    });
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
    const pool = new BlsMultiThreadWorkerPool({}, {logger, metrics: null, pubkeyCache});
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

  for (const batchable of [true, false]) {
    it(`Should verify indexed and aggregate sets resolved in the worker batchable=${batchable}`, async () => {
      const pool = await initializePool();

      expect(await pool.verifySignatureSets(workerResolvedSets, {batchable})).toBe(true);

      await pool.close();
    });
  }

  it("Should reject only the request with an unknown validator index", async () => {
    const pool = await initializePool();

    const unknownIndexSet: ISignatureSet = {
      type: SignatureSetType.indexed,
      index: 10_000_000, // never in the cache
      signingRoot: Buffer.alloc(32, 70),
      signature: sets[0].signature,
    };

    // The bad request rejects; concurrent valid requests are unaffected
    const badPromise = pool.verifySignatureSets([unknownIndexSet], {batchable: true});
    const goodPromise = pool.verifySignatureSets(workerResolvedSets, {batchable: true});

    await expect(badPromise).rejects.toThrow(/index 10000000 not found/);
    expect(await goodPromise).toBe(true);

    await pool.close();
  });
});
