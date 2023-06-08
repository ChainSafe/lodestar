import {expect} from "chai";
import {verifyMultipleAggregateSignatures, verifyMultipleAggregateSignaturesSync} from "../../import";
import {TestCase, TestPhase, TestSyncOrAsync, makeNapiTestSets, runTest} from "../utils";
import {invalidInputs, validSignatureSet} from "../__fixtures__";

describe("SignatureSet", () => {
  it("should only accept a valid SignatureSet object", () => {
    expect(runTest(TestSyncOrAsync.SYNC, TestPhase.SETUP, TestCase.SIGNATURE_SET, validSignatureSet)).to.equal(
      "VALID_TEST"
    );
  });
  describe("should throw for invalid inputs", () => {
    it("should throw for non-object input", () => {
      expect(() => runTest(TestSyncOrAsync.SYNC, TestPhase.SETUP, TestCase.SIGNATURE_SET, [])).to.throw(
        "SignatureSet must be an object with msg, publicKey and signature properties"
      );
    });

    for (const [name, input] of invalidInputs) {
      it(`should throw for 'msg' that is a ${name}`, () => {
        const badMsg = {
          ...validSignatureSet,
          msg: input,
        };
        expect(() => runTest(TestSyncOrAsync.SYNC, TestPhase.SETUP, TestCase.SIGNATURE_SET, badMsg)).to.throw(
          "msg must be of type BlstBuffer"
        );
      });
      it(`should throw for 'publicKey' that is a ${name}`, () => {
        const badMsg = {
          ...validSignatureSet,
          publicKey: input,
        };
        expect(() => runTest(TestSyncOrAsync.SYNC, TestPhase.SETUP, TestCase.SIGNATURE_SET, badMsg)).to.throw(
          "PublicKeyArg must be a PublicKey instance or a 48/96 byte Uint8Array"
        );
      });
      it(`should throw for 'signature' that is a ${name}`, () => {
        const badMsg = {
          ...validSignatureSet,
          signature: input,
        };
        expect(() => runTest(TestSyncOrAsync.SYNC, TestPhase.SETUP, TestCase.SIGNATURE_SET, badMsg)).to.throw(
          "SignatureArg must be a Signature instance or a 96/192 byte Uint8Array"
        );
      });
    }
  });
});
describe("SignatureSetArray", () => {
  it("should throw for non-array input", () => {
    expect(() =>
      runTest(TestSyncOrAsync.SYNC, TestPhase.SETUP, TestCase.SIGNATURE_SET_ARRAY, Buffer.from("valid"))
    ).to.throw("signatureSets must be of type SignatureSet[]");
  });
});

describe("Verify Multiple Aggregate Signatures", () => {
  describe("verifyMultipleAggregateSignaturesSync", () => {
    it("should return a boolean", () => {
      expect(verifyMultipleAggregateSignaturesSync([])).to.be.a("boolean");
    });
    it("should default to false", () => {
      expect(verifyMultipleAggregateSignaturesSync([])).to.be.false;
    });
    it("should return true for valid sets", () => {
      expect(verifyMultipleAggregateSignaturesSync(makeNapiTestSets(6))).to.be.true;
    });
  });
  describe("verifyMultipleAggregateSignatures", () => {
    it("should return Promise<boolean>", async () => {
      const resPromise = verifyMultipleAggregateSignatures([]);
      expect(resPromise).to.be.instanceOf(Promise);
      const res = await resPromise;
      expect(res).to.be.a("boolean");
    });
    it("should default to Promise<false>", async () => {
      expect(await verifyMultipleAggregateSignatures([])).to.be.false;
    });
    it("should return true for valid sets", async () => {
      expect(await verifyMultipleAggregateSignatures(makeNapiTestSets(6))).to.be.true;
    });
  });
});
