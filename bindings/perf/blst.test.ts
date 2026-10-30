import crypto from "node:crypto";
import {bench, describe} from "@chainsafe/benchmark";
import {
  SecretKey,
  type Signature,
  aggregatePublicKeys,
  aggregateSignatures,
  aggregateVerify,
  verifyMultipleAggregateSignatures,
} from "../src/blst.js";

interface SignatureSet {
  msg: Uint8Array;
  pk: InstanceType<typeof SecretKey> extends {toPublicKey(): infer P} ? P : never;
  sig: InstanceType<typeof Signature>;
}

function generateSets(count: number): SignatureSet[] {
  return Array.from({length: count}, () => {
    const msg = crypto.randomBytes(32);
    const sk = SecretKey.fromKeygen(crypto.randomBytes(32));
    const pk = sk.toPublicKey();
    const sig = sk.sign(msg);
    return {msg, pk, sig};
  });
}

describe("aggregatePublicKeys", () => {
  for (const count of [1, 8, 32, 128, 256]) {
    bench({
      beforeEach: () => generateSets(count).map((s) => s.pk),
      fn: (publicKeys) => {
        aggregatePublicKeys(publicKeys);
      },
      id: `aggregatePublicKeys ${count} keys`,
    });
  }
});

describe("aggregateSignatures", () => {
  for (const count of [1, 8, 32, 128, 256]) {
    bench({
      beforeEach: () => generateSets(count).map((s) => s.sig),
      fn: (signatures) => {
        aggregateSignatures(signatures);
      },
      id: `aggregateSignatures ${count} sigs`,
    });
  }
});

describe("aggregateVerify", () => {
  for (const count of [3, 8, 32, 64, 128]) {
    bench({
      beforeEach: () => {
        const sets = generateSets(count);
        return {
          messages: sets.map((s) => s.msg),
          publicKeys: sets.map((s) => s.pk),
          signature: aggregateSignatures(sets.map((s) => s.sig)),
        };
      },
      fn: ({messages, publicKeys, signature}) => {
        const isValid = aggregateVerify(messages, publicKeys, signature);
        if (!isValid) throw Error("Invalid");
      },
      id: `aggregateVerify ${count} sets`,
    });
  }
});

describe("verifyMultipleAggregateSignatures", () => {
  for (const count of [3, 8, 32, 64, 128]) {
    bench({
      beforeEach: () => generateSets(count),
      fn: (sets) => {
        const isValid = verifyMultipleAggregateSignatures(sets);
        if (!isValid) throw Error("Invalid");
      },
      id: `verifyMultipleAggregateSignatures ${count} sets`,
    });
  }
});
