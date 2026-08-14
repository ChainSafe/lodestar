import crypto from "node:crypto";
import {bench, describe} from "@chainsafe/benchmark";
import {
  PublicKey,
  SecretKey,
  Signature,
  aggregatePublicKeys,
  aggregateSignatures,
  asyncAggregateWithRandomness,
  verify,
  verifyMultipleAggregateSignatures,
} from "@chainsafe/lodestar-z/blst";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {linspace} from "../../../src/util/numpy.js";

describe("BLS ops", () => {
  type Keypair = {publicKey: PublicKey; secretKey: SecretKey};
  // signature needs to be in Uint8Array to match real situation
  type BlsSet = {publicKey: PublicKey; message: Uint8Array; signature: Uint8Array};

  // Create and cache (on demand) crypto data to benchmark
  const sets = new Map<number, BlsSet>();
  const sameMessageSets = new Map<number, BlsSet>();
  const keypairs = new Map<number, Keypair>();

  function getKeypair(i: number): Keypair {
    let keypair = keypairs.get(i);
    if (!keypair) {
      const bytes = new Uint8Array(32);
      const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      dataView.setUint32(0, i + 1, true);
      const secretKey = SecretKey.fromKeygen(bytes);
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
      set = {publicKey, message: message, signature: secretKey.sign(message).toBytes()};
      sets.set(i, set);
    }
    return set;
  }

  const seedMessage = crypto.randomBytes(32);
  function getSetSameMessage(i: number): BlsSet {
    const message = new Uint8Array(32);
    message.set(seedMessage);
    let set = sameMessageSets.get(i);
    if (!set) {
      const {secretKey, publicKey} = getKeypair(i);
      set = {publicKey, message, signature: secretKey.sign(message).toBytes()};
      sameMessageSets.set(i, set);
    }
    return set;
  }

  // Note: getSet() caches the value, does not re-compute every time
  bench({id: "BLS verify - blst", beforeEach: () => getSet(0)}, (set) => {
    const isValid = verify(set.message, set.publicKey, Signature.fromBytes(set.signature));
    if (!isValid) throw Error("Invalid");
  });

  // An aggregate and proof object has 3 signatures.
  // We may want to bundle up to 32 sets in a single batch.
  for (const count of [3, 8, 32, 64, 128]) {
    bench({
      id: `BLS verifyMultipleSignatures ${count} - blst`,
      beforeEach: () => linspace(0, count - 1).map((i) => getSet(i)),
      fn: (sets) => {
        const isValid = verifyMultipleAggregateSignatures(
          sets.map((set) => ({
            pk: set.publicKey,
            msg: set.message,
            sig: Signature.fromBytes(set.signature),
          }))
        );
        if (!isValid) throw Error("Invalid");
      },
    });
  }

  // this is total time we deserialize all signatures of validators per epoch
  // ideally we want to track 700_000, 1_400_000, 2_100_000 validators but it takes too long
  for (const numValidators of [10_000, 100_000]) {
    const signatures = linspace(0, numValidators - 1).map((i) => getSet(i % 256).signature);
    bench({
      id: `BLS deserializing ${numValidators} signatures`,
      fn: () => {
        for (const signature of signatures) {
          // true = validate signature
          Signature.fromBytes(signature, true);
        }
      },
    });
  }

  // An aggregate and proof object has 3 signatures.
  // We may want to bundle up to 32 sets in a single batch.
  // TODO: figure out why it does not work with 256 or more
  for (const count of [3, 8, 32, 64, 128]) {
    bench({
      id: `BLS verifyMultipleSignatures - same message - ${count} - blst`,
      beforeEach: () => linspace(0, count - 1).map((i) => getSetSameMessage(i)),
      fn: (sets) => {
        // aggregate and verify aggregated signatures
        const aggregatedPubkey = aggregatePublicKeys(sets.map((set) => set.publicKey));
        const aggregatedSignature = aggregateSignatures(sets.map((set) => Signature.fromBytes(set.signature)));
        const isValid = verify(sets[0].message, aggregatedPubkey, aggregatedSignature);
        if (!isValid) throw Error("Invalid");
      },
    });
  }

  // Attestations in Mainnet contain 128 max on average
  for (const count of [32, 128]) {
    bench({
      id: `BLS aggregatePubkeys ${count} - blst`,
      beforeEach: () => linspace(0, count - 1).map((i) => getKeypair(i).publicKey),
      fn: (pubkeys) => {
        aggregatePublicKeys(pubkeys);
      },
    });
  }

  // ---- by-index variants: keys resolve inside lodestar-z's native pubkey cache ----

  // Seed the process-wide cache once with the benchmark keypairs; the cache is
  // append-only and rejects duplicates, so resolve-or-append per key.
  const cacheIndexOf: number[] = [];
  for (let i = 0; i < 128; i++) {
    const bytes = getKeypair(i).publicKey.toBytes();
    const existing = pubkeyCache.getIndex(bytes);
    if (existing !== null) {
      cacheIndexOf.push(existing);
    } else {
      const index = pubkeyCache.size;
      pubkeyCache.append(index, bytes);
      cacheIndexOf.push(index);
    }
  }

  // The production same-message path (gossip attestation batches): keys are
  // referenced by validator index and resolved + randomness-aggregated natively.
  // Includes the randomness weighting the plain-aggregate bench above omits.
  for (const count of [3, 8, 32, 64, 128]) {
    bench({
      id: `BLS asyncAggregateWithRandomness by index - same message - ${count} - blst`,
      beforeEach: () =>
        linspace(0, count - 1).map((i) => ({index: cacheIndexOf[i], sig: getSetSameMessage(i).signature})),
      fn: async (sets) => {
        const {pk, sig} = await asyncAggregateWithRandomness(sets);
        const isValid = verify(seedMessage, pk, sig);
        if (!isValid) throw Error("Invalid");
      },
    });
  }

  // Counterpart of aggregatePubkeys: resolution + summation in one native call,
  // no PublicKey objects on the JS side.
  for (const count of [32, 128]) {
    bench({
      id: `BLS aggregatePubkeys by index ${count} - lodestar-z pubkeyCache`,
      beforeEach: () => linspace(0, count - 1).map((i) => cacheIndexOf[i]),
      fn: (indices) => {
        pubkeyCache.aggregate(indices);
      },
    });
  }
});
