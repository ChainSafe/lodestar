import {itBench} from "@dapplion/benchmark";
import bls from "@chainsafe/bls";
import type {PublicKey, SecretKey, Signature} from "@chainsafe/bls/types";
import {linspace} from "../../../src/util/numpy.js";

describe("BLS ops", function () {
  type Keypair = {publicKey: PublicKey; secretKey: SecretKey};
  type BlsSet = {publicKey: PublicKey; message: Uint8Array; signature: Signature};

  // Create and cache (on demand) crypto data to benchmark
  const sets = new Map<number, BlsSet>();
  const keypairs = new Map<number, Keypair>();

  function getKeypair(i: number): Keypair {
    let keypair = keypairs.get(i);
    if (!keypair) {
      const secretKey = bls.SecretKey.fromBytes(Buffer.alloc(32, i + 1));
      const publicKey = secretKey.toPublicKey();
      keypair = {secretKey, publicKey};
      keypairs.set(i, keypair);
    }
    return keypair;
  }

  function getSet(i: number): BlsSet {
    let set = sets.get(i);
    if (!set) {
      const {secretKey, publicKey} = getKeypair(i);
      const message = Buffer.alloc(32, i + 1);
      set = {publicKey, message: message, signature: secretKey.sign(message)};
      sets.set(i, set);
    }
    return set;
  }

  // Note: getSet() caches the value, does not re-compute every time
  itBench({id: `BLS verify - ${bls.implementation}`, beforeEach: () => getSet(0)}, (set) => {
    const isValid = set.signature.verify(set.publicKey, set.message);
    if (!isValid) throw Error("Invalid");
  });

  // An aggregate and proof object has 3 signatures.
  // We may want to bundle up to 32 sets in a single batch.
  for (const count of [3, 8, 32]) {
    itBench({
      id: `BLS verifyMultipleSignatures ${count} - ${bls.implementation}`,
      beforeEach: () => linspace(0, count - 1).map((i) => getSet(i)),
      fn: (sets) => {
        const isValid = bls.Signature.verifyMultipleSignatures(sets);
        if (!isValid) throw Error("Invalid");
      },
    });
  }

  // Attestations in Mainnet contain 128 max on average
  for (const count of [32, 128]) {
    itBench({
      id: `BLS aggregatePubkeys ${count} - ${bls.implementation}`,
      beforeEach: () => linspace(0, count - 1).map((i) => getKeypair(i).publicKey),
      fn: (pubkeys) => {
        bls.PublicKey.aggregate(pubkeys);
      },
    });
  }
});
