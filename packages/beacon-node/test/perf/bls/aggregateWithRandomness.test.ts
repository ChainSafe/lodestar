import crypto from "node:crypto";
import {bench, describe} from "@chainsafe/benchmark";
import {PublicKey, SecretKey, asyncAggregateWithRandomness} from "@chainsafe/blst";
import {linspace} from "../../../src/util/numpy.js";

// Benchmarks asyncAggregateWithRandomness, the call wrapped by the
// aggregateWithRandomnessAsyncDuration metric in chain/bls/multithread/jobItem.ts.
describe("BLS aggregateWithRandomness", () => {
  type Keypair = {publicKey: PublicKey; secretKey: SecretKey};
  // sig as Uint8Array to match the real same-message job (jobItem.ts)
  type PkAndSerializedSig = {pk: PublicKey; sig: Uint8Array};

  const keypairs = new Map<number, Keypair>();
  const sets = new Map<number, PkAndSerializedSig>();

  function getKeypair(i: number): Keypair {
    let keypair = keypairs.get(i);
    if (!keypair) {
      const bytes = new Uint8Array(32);
      new DataView(bytes.buffer).setUint32(0, i + 1, true);
      const secretKey = SecretKey.fromKeygen(bytes);
      keypair = {secretKey, publicKey: secretKey.toPublicKey()};
      keypairs.set(i, keypair);
    }
    return keypair;
  }

  // single shared message across all sets - same-message scenario
  const message = crypto.randomBytes(32);
  function getSet(i: number): PkAndSerializedSig {
    let set = sets.get(i);
    if (!set) {
      const {secretKey, publicKey} = getKeypair(i);
      set = {pk: publicKey, sig: secretKey.sign(message).toBytes()};
      sets.set(i, set);
    }
    return set;
  }

  // matches MAX_SIGNATURE_SETS_PER_JOB chunking (128) and common attestation batch sizes
  const runsFactor = 100;
  for (const count of [32, 64, 128]) {
    bench({
      id: `BLS asyncAggregateWithRandomness - same message - ${count}`,
      beforeEach: () => linspace(0, count - 1).map((i) => getSet(i)),
      fn: async (sets) => {
        // loop runsFactor times so the reported time is per-op (repo convention, see util/set.test.ts)
        for (let i = 0; i < runsFactor; i++) {
          await asyncAggregateWithRandomness(sets);
        }
      },
      runsFactor,
    });
  }
});
