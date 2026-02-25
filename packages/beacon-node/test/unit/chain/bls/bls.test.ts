import {beforeEach, describe, expect, it} from "vitest";
import {SecretKey, Signature} from "@chainsafe/lodestar-z/blst";
import {getEmptyLogger} from "@lodestar/logger/empty";
import {ISignatureSet, SignatureSetType, getPubkeyCache} from "@lodestar/state-transition";
import {BlsVerifier} from "../../../../src/chain/bls/blsVerifier.js";

describe("BlsVerifier ", () => {
  const numKeys = 3;
  const secretKeys = Array.from({length: numKeys}, (_, i) => SecretKey.fromKeygen(Buffer.alloc(32, i)));
  // Use the native pubkey cache so blsBatch can resolve pubkeys by index
  const pubkeyCache = getPubkeyCache();
  for (const [i, sk] of secretKeys.entries()) {
    pubkeyCache.set(i, sk.toPublicKey().toBytes());
  }

  const verifier = new BlsVerifier(null, getEmptyLogger());

  describe("verifySignatureSets", () => {
    let sets: ISignatureSet[];

    beforeEach(() => {
      sets = secretKeys.map((secretKey, i) => {
        const signingRoot = Buffer.alloc(32, i);
        return {
          type: SignatureSetType.single,
          pubkey: secretKey.toPublicKey(),
          signingRoot,
          signature: secretKey.sign(signingRoot).toBytes(),
        };
      });
    });

    it("should verify all signatures", async () => {
      expect(await verifier.verifySignatureSets(sets)).toBe(true);
    });

    it("should return false if at least one signature is invalid", async () => {
      sets[1].signingRoot = Buffer.alloc(32, 10);
      expect(await verifier.verifySignatureSets(sets)).toBe(false);
    });

    it("should return false if at least one signature is malformed", async () => {
      const malformedSignature = Buffer.alloc(96, 10);
      expect(() => Signature.fromBytes(malformedSignature, true, true)).toThrow();
      sets[1].signature = malformedSignature;
      expect(await verifier.verifySignatureSets(sets)).toBe(false);
    });
  });

  describe("verifySignatureSetsSameMessage", () => {
    let sets: {index: number; signature: Uint8Array}[];
    const signingRoot = Buffer.alloc(32, 100);

    beforeEach(() => {
      sets = secretKeys.map((secretKey, i) => ({
        index: i,
        signature: secretKey.sign(signingRoot).toBytes(),
      }));
    });

    it("should verify all signatures", async () => {
      expect(await verifier.verifySignatureSetsSameMessage(sets, signingRoot)).toEqual([true, true, true]);
    });

    it("should return false for invalid signature", async () => {
      sets[1].signature = secretKeys[1].sign(Buffer.alloc(32)).toBytes();
      expect(await verifier.verifySignatureSetsSameMessage(sets, signingRoot)).toEqual([true, false, true]);
    });

    it("should return false for malformed signature", async () => {
      const malformedSignature = Buffer.alloc(96, 10);
      expect(() => Signature.fromBytes(malformedSignature, true, true)).toThrow();
      sets[1].signature = malformedSignature;
      expect(await verifier.verifySignatureSetsSameMessage(sets, signingRoot)).toEqual([true, false, true]);
    });
  });
});
