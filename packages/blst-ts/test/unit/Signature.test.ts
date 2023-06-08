import {expect} from "chai";
import {BLST_CONSTANTS, SecretKey, Signature} from "../../import";
import {TestCase, TestPhase, TestSyncOrAsync, expectEqualHex, expectNotEqualHex, runTest} from "../utils";
import {validSignature, badSignature, invalidInputs} from "../__fixtures__";

describe("Signature", () => {
  it("should exist", () => {
    expect(Signature).to.exist;
  });
  describe("constructor", () => {
    it("should have a private new Signature()", () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return
      expect(() => new (Signature as any)()).to.throw("Signature constructor is private");
    });
    describe("Signature.deserialize()", () => {
      it("should only take Uint8Array or Buffer", () => {
        expect(() => Signature.deserialize(3 as any)).to.throw("sigBytes must be of type BlstBuffer");
      });
      it("should only take 48 or 96 bytes", () => {
        expect(() => Signature.deserialize(Buffer.alloc(32, "*"))).to.throw(
          "sigBytes is 32 bytes, but must be 96 or 192 bytes long"
        );
      });
      it("should take uncompressed byte arrays", () => {
        expectEqualHex(
          Signature.deserialize(validSignature.uncompressed).serialize(false),
          validSignature.uncompressed
        );
      });
      it("should take compressed byte arrays", () => {
        expectEqualHex(Signature.deserialize(validSignature.compressed).serialize(), validSignature.compressed);
      });
    });
    describe("methods", () => {
      describe("serialize", () => {
        it("should return uncompressed", () => {
          expectEqualHex(
            Signature.deserialize(validSignature.uncompressed).serialize(false),
            validSignature.uncompressed
          );
        });
        it("should return compressed", () => {
          expectEqualHex(Signature.deserialize(validSignature.compressed).serialize(), validSignature.compressed);
        });
      });
      describe("sigValidate()", () => {
        it("should return undefined for valid", () => {
          const sig = Signature.deserialize(validSignature.compressed);
          expect(sig.sigValidateSync()).to.be.undefined;
        });
        it("should throw for invalid", () => {
          const pkSeed = Signature.deserialize(validSignature.compressed);
          const sig = Signature.deserialize(
            Uint8Array.from([...pkSeed.serialize().subarray(0, 94), ...Buffer.from("a1")])
          );
          expect(() => sig.sigValidateSync()).to.throw("blst::BLST_POINT_NOT_IN_GROUP");
        });
      });
    });
  });
});

describe("SignatureArg", () => {
  it("should accept compressed serialized key", () => {
    expect(runTest(TestSyncOrAsync.SYNC, TestPhase.SETUP, TestCase.SIGNATURE_ARG, validSignature.compressed)).to.equal(
      "VALID_TEST"
    );
  });
  it("should accept uncompressed serialized key", () => {
    expect(
      runTest(TestSyncOrAsync.SYNC, TestPhase.SETUP, TestCase.SIGNATURE_ARG, validSignature.uncompressed)
    ).to.equal("VALID_TEST");
  });
  it("should accept Signature as argument", () => {
    expect(
      runTest(
        TestSyncOrAsync.SYNC,
        TestPhase.SETUP,
        TestCase.SIGNATURE_ARG,
        Signature.deserialize(validSignature.uncompressed)
      )
    ).to.equal("VALID_TEST");
  });
  describe("should throw for invalid inputs", () => {
    expect(badSignature.length).to.equal(BLST_CONSTANTS.SIGNATURE_LENGTH_UNCOMPRESSED);

    const sk = SecretKey.fromKeygenSync();
    const inputs = [
      ["SecretKey", sk],
      ["PublicKey", sk.toPublicKey()],
    ].concat(invalidInputs);

    for (const [name, input] of inputs) {
      it(`should throw for ${name}`, () => {
        expect(() => runTest(TestSyncOrAsync.SYNC, TestPhase.SETUP, TestCase.SIGNATURE_ARG, input)).to.throw(
          "SignatureArg must be a Signature instance or a 96/192 byte Uint8Array"
        );
      });
    }
  });
  it("should throw for invalid Signature", () => {
    expect(() => runTest(TestSyncOrAsync.SYNC, TestPhase.SETUP, TestCase.SIGNATURE_ARG, badSignature)).to.throw(
      "BLST_BAD_ENCODING: Invalid Signature"
    );
  });
});
describe("SignatureArgArray", () => {
  it("should throw for non-array input", () => {
    expect(() =>
      runTest(TestSyncOrAsync.SYNC, TestPhase.SETUP, TestCase.SIGNATURE_ARG_ARRAY, Buffer.from("valid"))
    ).to.throw("signatures must be of type SignatureArg[]");
  });
  it("should throw for invalid key", () => {
    expect(badSignature.length).to.equal(BLST_CONSTANTS.SIGNATURE_LENGTH_UNCOMPRESSED);
    try {
      runTest(TestSyncOrAsync.SYNC, TestPhase.SETUP, TestCase.SIGNATURE_ARG_ARRAY, [
        validSignature.compressed,
        validSignature.uncompressed,
        badSignature,
      ]);
      throw new Error("function should throw");
    } catch (err) {
      expect((err as Error).message).to.equal("BLST_BAD_ENCODING: Invalid Signature at index 2");
    }
  });
});
