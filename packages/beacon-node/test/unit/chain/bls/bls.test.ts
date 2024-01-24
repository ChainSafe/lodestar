import {describe, it, expect, beforeEach, beforeAll} from "vitest";
import {CoordType, PublicKey, SecretKey, Signature} from "@chainsafe/blst-ts";
import {ISignatureSet, SignatureSetType} from "@lodestar/state-transition";
import {BlsSingleThreadVerifier} from "../../../../src/chain/bls/singleThread.js";
import {BlsMultiThreadWorkerPool} from "../../../../src/chain/bls/multithread.js";
import {testLogger} from "../../../utils/logger.js";
import {BlsPoolType} from "../../../../src/chain/options.js";

describe("BlsVerifier ", function () {
  // take time for creating thread pool
  const numKeys = 3;
  const secretKeys = Array.from({length: numKeys}, (_, i) => SecretKey.fromKeygen(Buffer.alloc(32, i)));
  const verifiers = [
    new BlsSingleThreadVerifier({metrics: null}),
    new BlsMultiThreadWorkerPool({blsPoolType: BlsPoolType.libuv}, {metrics: null, logger: testLogger()}),
    new BlsMultiThreadWorkerPool({blsPoolType: BlsPoolType.workers}, {metrics: null, logger: testLogger()}),
  ];

  beforeAll(async () => {
    for (const verifier of verifiers) {
      /* eslint-disable @typescript-eslint/ban-ts-comment */
      // @ts-ignore
      if (typeof verifier["waitTillInitialized"] === "function") {
        // @ts-ignore
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        await verifier["waitTillInitialized"]();
      }
      /* eslint-enable @typescript-eslint/ban-ts-comment */
    }
  });

  for (const verifier of verifiers) {
    describe(`${verifier.constructor.name} - verifySignatureSets`, () => {
      let sets: ISignatureSet[];

      beforeEach(() => {
        sets = secretKeys.map((secretKey, i) => {
          // different signing roots
          const signingRoot = Buffer.alloc(32, i);
          return {
            type: SignatureSetType.single,
            pubkey: secretKey.toPublicKey(),
            signingRoot,
            signature: secretKey.sign(signingRoot).serialize(),
          };
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
        expect(() => Signature.deserialize(malformedSignature, CoordType.affine)).toThrow();
        sets[1].signature = malformedSignature;
        expect(await verifier.verifySignatureSets(sets)).toBe(false);
      });
    });

    describe(`${verifier.constructor.name} - verifySignatureSetsSameMessage`, function () {
      let sets: {publicKey: PublicKey; signature: Uint8Array}[] = [];
      // same signing root for all sets
      const signingRoot = Buffer.alloc(32, 100);

      beforeEach(() => {
        sets = secretKeys.map((secretKey) => {
          return {
            publicKey: secretKey.toPublicKey(),
            signature: secretKey.sign(signingRoot).serialize(),
          };
        });
      });

      it("should verify all signatures", async () => {
        expect(await verifier.verifySignatureSetsSameMessage(sets, signingRoot)).toEqual([true, true, true]);
      });

      it("should return false for invalid signature", async () => {
        // signature is valid but not respective to the signing root
        sets[1].signature = secretKeys[1].sign(Buffer.alloc(32)).serialize();
        expect(await verifier.verifySignatureSetsSameMessage(sets, signingRoot)).toEqual([true, false, true]);
      });

      it("should return false for malformed signature", async () => {
        // signature is malformed
        const malformedSignature = Buffer.alloc(96, 10);
        expect(() => Signature.deserialize(malformedSignature, CoordType.affine)).toThrow();
        sets[1].signature = malformedSignature;
        expect(await verifier.verifySignatureSetsSameMessage(sets, signingRoot)).toEqual([true, false, true]);
      });
    });
  }
});
