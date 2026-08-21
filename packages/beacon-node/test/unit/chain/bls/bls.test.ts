import {beforeEach, describe, expect, it} from "vitest";
import {
  BLS_VERIFIER_MAX_BATCH_SIZE,
  BLS_VERIFIER_MAX_SAME_MESSAGE_BATCH_SIZE,
} from "@chainsafe/lodestar-z/bls-verifier";
import {SecretKey, Signature} from "@chainsafe/lodestar-z/blst";
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
    new BlsSingleThreadVerifier({metrics: null}),
    new BlsMultiThreadWorkerPool({}, {metrics: null, logger: testLogger()}),
  ];

  for (const verifier of verifiers) {
    describe(`${verifier.constructor.name} - verifySignatureSets`, () => {
      let sets: ISignatureSet[];

      beforeEach(() => {
        sets = secretKeys.map((secretKey, i) => {
          // different signing roots
          const signingRoot = Buffer.alloc(32, i);
          const signature = secretKey.sign(signingRoot).toBytes();
          switch (i) {
            case 0:
              return {
                type: SignatureSetType.single,
                pubkey: secretKey.toPublicKey().toBytes(),
                signingRoot,
                signature,
              };
            case 1:
              return {
                type: SignatureSetType.indexed,
                index: i,
                signingRoot,
                signature,
              };
            default:
              return {
                type: SignatureSetType.aggregate,
                indices: [i],
                signingRoot,
                signature,
              };
          }
        });
      });

      it("should verify all signatures", async () => {
        expect(await verifier.verifySignatureSets(sets)).toBe(true);
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

      it("should split sets larger than the native batch bound", async () => {
        expect(
          await verifier.verifySignatureSets(Array.from({length: BLS_VERIFIER_MAX_BATCH_SIZE + 1}, () => sets[1]))
        ).toBe(true);
      });

      it("should throw if a cached validator index is missing", async () => {
        const missingIndexSet: ISignatureSet = {
          type: SignatureSetType.indexed,
          index: pubkeyCache.size,
          signingRoot: sets[1].signingRoot,
          signature: sets[1].signature,
        };
        await expect(verifier.verifySignatureSets([missingIndexSet])).rejects.toThrow("PubkeyIndexNotFound");
      });

      it("should reject aggregate indices outside uint32", async () => {
        for (const index of [-1, 0.5, 2 ** 32]) {
          const invalidSet: ISignatureSet = {...sets[2], type: SignatureSetType.aggregate, indices: [index]};
          await expect(verifier.verifySignatureSets([invalidSet])).rejects.toThrow(`Invalid validator index ${index}`);
        }
      });
    });

    describe(`${verifier.constructor.name} - verifySignatureSetsSameMessage`, () => {
      let sets: {index: number; signature: Uint8Array}[] = [];
      // same signing root for all sets
      const signingRoot = Buffer.alloc(32, 100);

      beforeEach(() => {
        sets = secretKeys.map((secretKey, index) => {
          return {
            index,
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

      it("should split sets larger than the native same-message bound", async () => {
        const largeSets = Array.from(
          {length: BLS_VERIFIER_MAX_SAME_MESSAGE_BATCH_SIZE + 1},
          (_, i) => sets[i % sets.length]
        );
        expect(await verifier.verifySignatureSetsSameMessage(largeSets, signingRoot)).toEqual(
          largeSets.map(() => true)
        );
      });

      it("should throw if a same-message validator index is missing", async () => {
        await expect(
          verifier.verifySignatureSetsSameMessage([{...sets[0], index: pubkeyCache.size}], signingRoot)
        ).rejects.toThrow("PubkeyIndexNotFound");
      });
    });
  }
});
