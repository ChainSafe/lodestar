import {afterEach, beforeAll, beforeEach, describe, expect, it} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {testLogger} from "@lodestar/logger/test-utils";
import {ISignatureSet, SignatureSetType} from "@lodestar/state-transition";
import {VerifySignatureOpts} from "../../../../src/chain/bls/interface.js";
import {BlsMultiThreadVerifier} from "../../../../src/chain/bls/multithread/index.js";
import {QueueErrorCode} from "../../../../src/util/queue/index.js";

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

  async function initializePool(): Promise<BlsMultiThreadVerifier> {
    const pool = new BlsMultiThreadVerifier({}, {logger, metrics: null});
    afterEachCallbacks.push(() => pool.close());
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
      // Calls submitted in one turn are grouped before native execution.
      await testManyValidSignatures({sleep: false}, {priority});
    });
  }

  for (const priority of [true, false]) {
    it(`Should verify multiple signatures submitted asynchronously priority=${priority}`, async () => {
      // Because of the sleep, each set is submitted as a separate native root.
      await testManyValidSignatures({sleep: true}, {priority});
    });
  }

  for (const priority of [true, false]) {
    it(`Should verify multiple signatures batched priority=${priority}`, async () => {
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

  it("rejects buffered requests when closed", async () => {
    const pool = await initializePool();
    const result = pool.verifySignatureSets(sets, {batchable: true});

    await pool.close();
    await expect(result).rejects.toHaveProperty("type.code", QueueErrorCode.QUEUE_ABORTED);
  });
});
