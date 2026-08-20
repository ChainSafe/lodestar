import {beforeEach, describe, expect, it} from "vitest";
import {PublicKey, SecretKey, Signature} from "@chainsafe/blst";
import {testLogger} from "@lodestar/logger/test-utils";
import {ISignatureSet, SignatureSetType, createPubkeyCache} from "@lodestar/state-transition";
import {BlsMultiThreadWorkerPool} from "../../../../src/chain/bls/multithread/index.js";
import {BlsSingleThreadVerifier} from "../../../../src/chain/bls/singleThread.js";
import {createMetricsTest} from "../../metrics/utils.js";

describe("BlsVerifier ", () => {
  // take time for creating thread pool
  const numKeys = 3;
  const secretKeys = Array.from({length: numKeys}, (_, i) => SecretKey.fromKeygen(Buffer.alloc(32, i)));
  // Create a mock pubkeyCache that maps indices to public keys
  const pubkeyCache = createPubkeyCache();
  for (const [i, sk] of secretKeys.entries()) {
    pubkeyCache.set(i, sk.toPublicKey().toBytes());
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
      let sets: {publicKey: PublicKey; signature: Uint8Array}[] = [];
      // same signing root for all sets
      const signingRoot = Buffer.alloc(32, 100);

      beforeEach(() => {
        sets = secretKeys.map((secretKey) => {
          return {
            publicKey: secretKey.toPublicKey(),
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

  describe("BlsSingleThreadVerifier metrics", () => {
    it("should record verification duration metrics", async () => {
      const metrics = createMetricsTest();
      const verifier = new BlsSingleThreadVerifier({metrics, pubkeyCache});
      const sets = secretKeys.map((secretKey, i) => {
        const signingRoot = Buffer.alloc(32, i);
        return {
          type: SignatureSetType.single,
          pubkey: secretKey.toPublicKey(),
          signingRoot,
          signature: secretKey.sign(signingRoot).toBytes(),
        };
      });

      await verifier.verifySignatureSets(sets);

      const singleThreadTime = "lodestar_bls_single_thread_time_seconds";
      const singleThreadTimePerSigSet = "lodestar_bls_single_thread_time_per_sigset_seconds";
      await expect(metrics.register.getSingleMetricAsString(singleThreadTime)).resolves.toContain(
        `${singleThreadTime}_count 1`
      );
      await expect(metrics.register.getSingleMetricAsString(singleThreadTimePerSigSet)).resolves.toContain(
        `${singleThreadTimePerSigSet}_count 1`
      );

      metrics.close();
    });
  });

  describe("BlsMultiThreadWorkerPool metrics", () => {
    it("should count same-message signature sets in the incoming metrics", async () => {
      const metrics = createMetricsTest();
      const verifier = new BlsMultiThreadWorkerPool({}, {metrics, logger: testLogger(), pubkeyCache});
      const signingRoot = Buffer.alloc(32, 100);
      const sets = secretKeys.map((secretKey) => ({
        publicKey: secretKey.toPublicKey(),
        signature: secretKey.sign(signingRoot).toBytes(),
      }));

      await verifier.verifySignatureSetsSameMessage(sets, signingRoot, {priority: true, batchable: true});

      for (const metricName of [
        "lodestar_bls_thread_pool_sig_sets_total",
        "lodestar_bls_thread_pool_prioritized_sig_sets_total",
        "lodestar_bls_thread_pool_batchable_sig_sets_total",
      ]) {
        await expect(metrics.register.getSingleMetricAsString(metricName)).resolves.toContain(`${metricName} 3`);
      }

      await verifier.close();
      metrics.close();
    });
  });
});
