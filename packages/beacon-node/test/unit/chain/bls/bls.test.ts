import {beforeEach, describe, expect, it} from "vitest";
import {SecretKey, Signature, aggregateSignatures} from "@chainsafe/lodestar-z/blst";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {testLogger} from "@lodestar/logger/test-utils";
import {ISignatureSet, SignatureSetType} from "@lodestar/state-transition";
import {BlsMultiThreadWorkerPool} from "../../../../src/chain/bls/multithread/index.js";
import {BlsSingleThreadVerifier} from "../../../../src/chain/bls/singleThread.js";

describe("BlsVerifier ", () => {
  // take time for creating thread pool
  const numKeys = 3;
  const secretKeys = Array.from({length: numKeys}, (_, i) => SecretKey.fromKeygen(Buffer.alloc(32, i)));
  // Create a mock pubkeyCache that maps indices to public keys
  for (const [i, sk] of secretKeys.entries()) {
    pubkeyCache.append(i, sk.toPublicKey().toBytes());
  }
  const verifiers = [
    new BlsSingleThreadVerifier({metrics: null, pubkeyCache}),
    new BlsMultiThreadWorkerPool({}, {metrics: null, logger: testLogger(), pubkeyCache}),
  ];

  for (const verifier of verifiers) {
    describe(`${verifier.constructor.name} - verifySignatureSets`, () => {
      let sets: ISignatureSet[];

      beforeEach(() => {
        sets = secretKeys.map((secretKey, i) => {
          // different signing roots
          const signingRoot = Buffer.alloc(32, i);
          return {
            type: SignatureSetType.indexed,
            index: i,
            signingRoot,
            signature: secretKey.sign(signingRoot).toBytes(),
          };
        });
      });

      it("should verify all signatures", async () => {
        expect(await verifier.verifySignatureSets(sets)).toBe(true);
      });

      it("should verify a mixed batch of indexed, single, and aggregate sets", async () => {
        // single: a key that is NOT in the validator registry (deposit /
        // BLS-to-execution shape) — carried in the set, group-checked at verify.
        const outsiderSk = SecretKey.fromKeygen(Buffer.alloc(32, 99));
        const singleRoot = Buffer.alloc(32, 42);
        // aggregate: registry validators 0 and 1 co-sign one root.
        const aggRoot = Buffer.alloc(32, 43);
        const aggSignature = aggregateSignatures([secretKeys[0].sign(aggRoot), secretKeys[1].sign(aggRoot)]).toBytes();

        const mixed: ISignatureSet[] = [
          ...sets,
          {
            type: SignatureSetType.single,
            pubkey: outsiderSk.toPublicKey(),
            signingRoot: singleRoot,
            signature: outsiderSk.sign(singleRoot).toBytes(),
          },
          {type: SignatureSetType.aggregate, indices: [0, 1], signingRoot: aggRoot, signature: aggSignature},
        ];
        expect(await verifier.verifySignatureSets(mixed)).toBe(true);
      });

      it("should return false if at least one signature is invalid", async () => {
        // signature is valid but not respective to the signing root
        sets[1].signingRoot = Buffer.alloc(32, 10);
        expect(await verifier.verifySignatureSets(sets)).toBe(false);
      });

      it("should return false if at least one signature is malformed", async () => {
        // signature is malformed
        const malformedSignature = Buffer.alloc(96, 10);
        expect(() => Signature.fromBytes(malformedSignature, true, true)).toThrow();
        sets[1].signature = malformedSignature;
        expect(await verifier.verifySignatureSets(sets)).toBe(false);
      });
    });

    describe(`${verifier.constructor.name} - verifySignatureSetsSameMessage`, () => {
      let sets: {index: number; signature: Uint8Array}[] = [];
      // same signing root for all sets
      const signingRoot = Buffer.alloc(32, 100);

      beforeEach(() => {
        sets = secretKeys.map((secretKey, i) => {
          return {
            index: i,
            signature: secretKey.sign(signingRoot).toBytes(),
          };
        });
      });

      it("should verify all signatures", async () => {
        expect(await verifier.verifySignatureSetsSameMessage(sets, signingRoot)).toEqual([true, true, true]);
      });

      it("should return false for invalid signature", async () => {
        // signature is valid but not respective to the signing root
        sets[1].signature = secretKeys[1].sign(Buffer.alloc(32)).toBytes();
        expect(await verifier.verifySignatureSetsSameMessage(sets, signingRoot)).toEqual([true, false, true]);
      });

      it("should return false for malformed signature", async () => {
        // signature is malformed
        const malformedSignature = Buffer.alloc(96, 10);
        expect(() => Signature.fromBytes(malformedSignature, true, true)).toThrow();
        sets[1].signature = malformedSignature;
        expect(await verifier.verifySignatureSetsSameMessage(sets, signingRoot)).toEqual([true, false, true]);
      });
    });
  }
});
