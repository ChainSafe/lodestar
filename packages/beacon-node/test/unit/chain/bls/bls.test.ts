import bls from "@chainsafe/bls";
import {expect} from "chai";
import {CoordType} from "@chainsafe/blst";
import {PublicKey} from "@chainsafe/bls/types";
import {ISignatureSet, SignatureSetType} from "@lodestar/state-transition";
import {BlsSingleThreadVerifier} from "../../../../src/chain/bls/singleThread.js";
import {BlsMultiThreadWorkerPool} from "../../../../lib/chain/bls/multithread/index.js";
import {testLogger} from "../../../utils/logger.js";

describe("BlsVerifier ", function () {
  // take time for creating thread pool
  this.timeout(60 * 1000);
  const numKeys = 3;
  const secretKeys = Array.from({length: numKeys}, (_, i) => bls.SecretKey.fromKeygen(Buffer.alloc(32, i)));
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
          return {
            type: SignatureSetType.single,
            pubkey: secretKey.toPublicKey(),
            signingRoot,
            signature: secretKey.sign(signingRoot).toBytes(),
          };
        });
      });

      it("should verify all signatures", async () => {
        expect(await verifier.verifySignatureSets(sets)).to.be.true;
      });

      it("should return false if at least one signature is invalid", async () => {
        // signature is valid but not respective to the signing root
        sets[1].signingRoot = Buffer.alloc(32, 10);
        expect(await verifier.verifySignatureSets(sets)).to.be.false;
      });

      it("should return false if at least one signature is malformed", async () => {
        // signature is malformed
        const malformedSignature = Buffer.alloc(96, 10);
        expect(() => bls.Signature.fromBytes(malformedSignature, CoordType.affine, true)).to.throws();
        sets[1].signature = malformedSignature;
        expect(await verifier.verifySignatureSets(sets)).to.be.false;
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
        expect(await verifier.verifySignatureSetsSameMessage(sets, signingRoot)).to.deep.equal([true, true, true]);
      });

      it("should return false for invalid signature", async () => {
        // signature is valid but not respective to the signing root
        sets[1].signature = secretKeys[1].sign(Buffer.alloc(32)).toBytes();
        expect(await verifier.verifySignatureSetsSameMessage(sets, signingRoot)).to.be.deep.equal([true, false, true]);
      });

      it("should return false for malformed signature", async () => {
        // signature is malformed
        const malformedSignature = Buffer.alloc(96, 10);
        expect(() => bls.Signature.fromBytes(malformedSignature, CoordType.affine, true)).to.throws();
        sets[1].signature = malformedSignature;
        expect(await verifier.verifySignatureSetsSameMessage(sets, signingRoot)).to.be.deep.equal([true, false, true]);
      });
    });
  }
});
