import {itBench} from "@dapplion/benchmark";
import bls from "blst-ts-test";
import {linspace} from "../../../src/util/numpy.js";

describe("BLS ops", function () {
  type Keypair = {publicKey: bls.PublicKey; secretKey: bls.SecretKey};
  type BlsSet = {publicKey: bls.PublicKey; msg: Uint8Array; signature: bls.Signature};

  // Create and cache (on demand) crypto data to benchmark
  const sets = new Map<number, BlsSet>();
  const keypairs = new Map<number, Keypair>();

  function getKeypair(i: number): Keypair {
    let keypair = keypairs.get(i);
    if (!keypair) {
      const secretKey = bls.SecretKey.deserialize(Buffer.alloc(32, i + 1));
      const publicKey = secretKey.toPublicKey();
      keypair = {secretKey, publicKey};
      keypairs.set(i, keypair);
    }
    return keypair;
  }

  async function getSet(i: number): Promise<BlsSet> {
    let set = sets.get(i);
    if (!set) {
      const {secretKey, publicKey} = getKeypair(i);
      const message = Buffer.alloc(32, i + 1);
      set = {publicKey, msg: message, signature: await secretKey.sign(message)};
      sets.set(i, set);
    }
    return set;
  }

  // Note: getSet() caches the value, does not re-compute every time
  itBench({id: "BLS verify - Napi", beforeEach: () => getSet(0)}, async (set) => {
    const isValid = await bls.verify(set.msg, set.publicKey, set.signature);
    if (!isValid) throw Error("Invalid");
  });

  // An aggregate and proof object has 3 signatures.
  // We may want to bundle up to 32 sets in a single batch.
  for (const count of [3, 8, 32]) {
    itBench({
      id: `BLS verifyMultipleSignatures ${count} - Napi`,
      beforeEach: () => Promise.all(linspace(0, count - 1).map((i) => getSet(i))),
      fn: async (sets) => {
        const isValid = await bls.verifyMultipleAggregateSignatures(sets);
        if (!isValid) throw Error("Invalid");
      },
    });
  }

  // Attestations in Mainnet contain 128 max on average
  for (const count of [32, 128]) {
    itBench({
      id: `BLS aggregatePubkeys ${count} - Napi`,
      beforeEach: () => Promise.all(linspace(0, count - 1).map((i) => getKeypair(i).publicKey)),
      fn: async (pubkeys) => {
        await bls.aggregatePublicKeys(pubkeys);
      },
    });
  }
});
