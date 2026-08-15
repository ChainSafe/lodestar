import {afterAll, bench, describe} from "@chainsafe/benchmark";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {testLogger} from "@lodestar/logger/test-utils";
import {ISignatureSet, SignatureSetType} from "@lodestar/state-transition";
import {BlsMultiThreadVerifier} from "../../../src/chain/bls/multithread/index.js";

describe("native BLS scheduler", () => {
  const pool = new BlsMultiThreadVerifier({}, {logger: testLogger(), metrics: null});
  const sameMessage = new Uint8Array(32).fill(255);
  const sameMessageSets: {index: number; signature: Uint8Array}[] = [];
  const generalSets: ISignatureSet[] = [];

  for (let i = 0; i < 128; i++) {
    const ikm = new Uint8Array(32);
    new DataView(ikm.buffer).setUint32(0, i + 1, true);
    const secretKey = SecretKey.fromKeygen(ikm);
    const index = pubkeyCache.size;
    pubkeyCache.append(index, secretKey.toPublicKey().toBytes());

    const signingRoot = new Uint8Array(32);
    new DataView(signingRoot.buffer).setUint32(0, i + 1, true);
    generalSets.push({
      type: SignatureSetType.indexed,
      index,
      signingRoot,
      signature: secretKey.sign(signingRoot).toBytes(),
    });
    sameMessageSets.push({index, signature: secretKey.sign(sameMessage).toBytes()});
  }

  afterAll(() => pool.close());

  for (const count of [1, 32, 128]) {
    bench({
      id: `BLS scheduler general batch ${count}`,
      beforeEach: () => generalSets.slice(0, count),
      fn: async (sets) => {
        if (!(await pool.verifySignatureSets(sets, {priority: true}))) throw Error("Invalid signature");
      },
    });
  }

  bench({
    id: "BLS scheduler same-message batch 128",
    fn: async () => {
      const results = await pool.verifySignatureSetsSameMessage(sameMessageSets, sameMessage, {priority: true});
      if (results.some((result) => !result)) throw Error("Invalid signature");
    },
  });

  bench({
    id: "BLS scheduler 32 concurrent critical singletons",
    runsFactor: 32,
    fn: async () => {
      const results = await Promise.all(
        generalSets.slice(0, 32).map((set) => pool.verifySignatureSets([set], {priority: true}))
      );
      if (results.some((result) => !result)) throw Error("Invalid signature");
    },
  });

  bench({
    id: "BLS scheduler 128 concurrent critical singletons",
    runsFactor: 128,
    fn: async () => {
      const results = await Promise.all(generalSets.map((set) => pool.verifySignatureSets([set], {priority: true})));
      if (results.some((result) => !result)) throw Error("Invalid signature");
    },
  });

  bench({
    id: "BLS scheduler 33 cross-request batchable singletons",
    runsFactor: 33,
    fn: async () => {
      const results = await Promise.all(
        generalSets.slice(0, 33).map((set) => pool.verifySignatureSets([set], {batchable: true}))
      );
      if (results.some((result) => !result)) throw Error("Invalid signature");
    },
  });
});
