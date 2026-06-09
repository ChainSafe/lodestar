import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {blsBatch} from "@chainsafe/lodestar-z/bls-batch";
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

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

    it("delegates backpressure to native blsBatch", () => {
      vi.spyOn(blsBatch, "canAcceptWork").mockReturnValue(false);

      expect(verifier.canAcceptWork()).toBe(false);
      expect(blsBatch.canAcceptWork).toHaveBeenCalled();
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

  // A single bucket larger than the native 128-set per-job cap must be chunked,
  // otherwise the native `TooManySets` error is swallowed and valid signatures
  // (e.g. a maximally packed block) are reported invalid.
  describe("chunking (> MAX_SETS_PER_JOB)", () => {
    const n = 129; // one more than the native 128-set cap
    const sks = Array.from({length: n}, (_, i) => SecretKey.fromKeygen(Buffer.alloc(32, i)));
    // Populate the native pubkey cache so the same-message path can resolve indices
    for (let i = 0; i < n; i++) {
      pubkeyCache.set(i, sks[i].toPublicKey().toBytes());
    }

    function makeSingleSets(): ISignatureSet[] {
      return sks.map((sk, i) => {
        const signingRoot = Buffer.alloc(32, i);
        return {
          type: SignatureSetType.single,
          pubkey: sk.toPublicKey(),
          signingRoot,
          signature: sk.sign(signingRoot).toBytes(),
        };
      });
    }

    it("verifies > 128 valid sets async", async () => {
      expect(await verifier.verifySignatureSets(makeSingleSets())).toBe(true);
    });

    it("verifies > 128 valid sets on the main thread", async () => {
      expect(await verifier.verifySignatureSets(makeSingleSets(), {verifyOnMainThread: true})).toBe(true);
    });

    it("returns false when a set past the chunk boundary is invalid", async () => {
      const sets = makeSingleSets();
      sets[128].signingRoot = Buffer.alloc(32, 200); // wrong message for the 129th set
      expect(await verifier.verifySignatureSets(sets)).toBe(false);
      expect(await verifier.verifySignatureSets(sets, {verifyOnMainThread: true})).toBe(false);
    });

    it("verifies > 128 same-message sets", async () => {
      const signingRoot = Buffer.alloc(32, 123);
      const sets = sks.map((sk, i) => ({index: i, signature: sk.sign(signingRoot).toBytes()}));
      const results = await verifier.verifySignatureSetsSameMessage(sets, signingRoot);
      expect(results).toHaveLength(n);
      expect(results.every((r) => r)).toBe(true);
    });

    it("isolates an invalid set past the chunk boundary among same-message sets", async () => {
      const signingRoot = Buffer.alloc(32, 124);
      const sets = sks.map((sk, i) => ({index: i, signature: sk.sign(signingRoot).toBytes()}));
      sets[128].signature = sks[128].sign(Buffer.alloc(32, 1)).toBytes(); // wrong message
      const results = await verifier.verifySignatureSetsSameMessage(sets, signingRoot);
      expect(results[128]).toBe(false);
      expect(results.filter((r) => r)).toHaveLength(n - 1);
    });
  });

  // Operational failures (pool exhausted, shutdown, ...) must NOT be reported as an
  // invalid signature (`false`), which would wrongly REJECT gossip / mark valid blocks
  // invalid. They are rethrown; genuine bad-input errors still return `false`.
  describe("operational vs verification errors", () => {
    let sets: ISignatureSet[];
    const signingRoot = Buffer.alloc(32, 50);

    function blsError(code: string): Error {
      return Object.assign(new Error(`blsBatch: ${code}`), {code});
    }

    beforeEach(() => {
      sets = secretKeys.map((sk) => ({
        type: SignatureSetType.single,
        pubkey: sk.toPublicKey(),
        signingRoot,
        signature: sk.sign(signingRoot).toBytes(),
      }));
    });

    it("rethrows operational errors (async) instead of returning false", async () => {
      vi.spyOn(blsBatch, "asyncVerify").mockImplementation(() => {
        throw blsError("PoolExhausted");
      });
      await expect(verifier.verifySignatureSets(sets)).rejects.toMatchObject({code: "PoolExhausted"});
    });

    it("does not retry batchable jobs after native operational failure", async () => {
      const spy = vi.spyOn(blsBatch, "asyncVerify").mockImplementation(() => {
        throw blsError("PoolExhausted");
      });
      const manySets = Array.from({length: 32}, (_, i) => sets[i % sets.length]);

      await expect(verifier.verifySignatureSets(manySets, {batchable: true})).rejects.toMatchObject({
        code: "PoolExhausted",
      });
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("returns false (not throw) for genuine verification errors (async)", async () => {
      vi.spyOn(blsBatch, "asyncVerify").mockImplementation(() => {
        throw blsError("DeserializationFailed");
      });
      expect(await verifier.verifySignatureSets(sets)).toBe(false);
    });

    it("rethrows operational errors on the main thread", async () => {
      vi.spyOn(blsBatch, "verify").mockImplementation(() => {
        throw blsError("PoolShuttingDown");
      });
      await expect(verifier.verifySignatureSets(sets, {verifyOnMainThread: true})).rejects.toMatchObject({
        code: "PoolShuttingDown",
      });
    });

    it("rethrows operational errors in the same-message path", async () => {
      vi.spyOn(blsBatch, "asyncVerifySameMessage").mockImplementation(() => {
        throw blsError("PoolExhausted");
      });
      const smSets = secretKeys.map((sk, i) => ({index: i, signature: sk.sign(signingRoot).toBytes()}));
      await expect(verifier.verifySignatureSetsSameMessage(smSets, signingRoot)).rejects.toMatchObject({
        code: "PoolExhausted",
      });
    });
  });
});
