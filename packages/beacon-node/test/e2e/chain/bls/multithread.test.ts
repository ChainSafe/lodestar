import {expect} from "chai";
import bls from "@chainsafe/bls";
import {ISignatureSet, SignatureSetType} from "@lodestar/state-transition";
import {BlsMultiThreadWorkerPool} from "../../../../src/chain/bls/multithread/index.js";
import {testLogger} from "../../../utils/logger.js";
import {VerifySignatureOpts} from "../../../../src/chain/bls/interface.js";

describe("chain / bls / multithread queue", function () {
  this.timeout(30 * 1000);
  const logger = testLogger();

  let controller: AbortController;
  beforeEach(() => (controller = new AbortController()));
  afterEach(() => controller.abort());

  const afterEachCallbacks: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  const sets: ISignatureSet[] = [];
  before("generate test data", () => {
    for (let i = 0; i < 3; i++) {
      const sk = bls.SecretKey.fromBytes(Buffer.alloc(32, i + 1));
      const msg = Buffer.alloc(32, i + 1);
      const pk = sk.toPublicKey();
      const sig = sk.sign(msg);
      sets.push({
        type: SignatureSetType.single,
        pubkey: pk,
        signingRoot: msg,
        signature: sig.toBytes(),
      });
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

    const isValidPromiseArr: Promise<boolean>[] = [];
    for (let i = 0; i < 8; i++) {
      isValidPromiseArr.push(pool.verifySignatureSets(sets, verifySignatureOpts));
      if (testOpts.sleep) {
        // Tick forward so the pool sends a job out
        await new Promise((r) => setTimeout(r, 5));
      }
    }

    const isValidArr = await Promise.all(isValidPromiseArr);
    for (const [i, isValid] of isValidArr.entries()) {
      expect(isValid).to.equal(true, `sig set ${i} returned invalid`);
    }
  }

  it("Should verify multiple signatures submitted synchronously", async () => {
    // Given the `setTimeout(this.runJob, 0);` all sets should be verified in a single job an worker
    await testManyValidSignatures({sleep: false});
  });

  it("Should verify multiple signatures submitted asynchronously", async () => {
    // Because of the sleep, each sets submitted should be verified in a different job and worker
    await testManyValidSignatures({sleep: true});
  });

  it("Should verify multiple signatures batched", async () => {
    // By setting batchable: true, 5*8 = 40 sig sets should be verified in one job, while 3*8=24 should
    // be verified in another job
    await testManyValidSignatures({sleep: true}, {batchable: true});
  });

  it("Should verify multiple signatures batched, first is invalid", async () => {
    // If the first signature is invalid it should not make the rest throw
    const pool = await initializePool();

    const invalidSet: ISignatureSet = {...sets[0], signature: Buffer.alloc(32, 0)};
    const isInvalidPromise = pool.verifySignatureSets([invalidSet], {batchable: true});
    const isValidPromiseArr: Promise<boolean>[] = [];
    for (let i = 0; i < 8; i++) {
      isValidPromiseArr.push(pool.verifySignatureSets(sets, {batchable: true}));
    }

    await expect(isInvalidPromise).to.rejectedWith("BLST_INVALID_SIZE");

    const isValidArr = await Promise.all(isValidPromiseArr);
    for (const [i, isValid] of isValidArr.entries()) {
      expect(isValid).to.equal(true, `sig set ${i} returned invalid`);
    }
  });
});
