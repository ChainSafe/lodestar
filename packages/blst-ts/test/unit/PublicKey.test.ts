import {expect} from "chai";
import {BLST_CONSTANTS, PublicKey, SecretKey} from "../../import";
import {TestCase, TestPhase, TestSyncOrAsync, expectEqualHex, expectNotEqualHex, runTest} from "../utils";
import {badPublicKey, validPublicKey, SECRET_KEY_BYTES, invalidInputs} from "../__fixtures__";

describe("PublicKey", () => {
  it("should exist", () => {
    expect(PublicKey).to.exist;
  });
  describe("constructors", () => {
    describe("new PublicKey()", () => {
      it("should have a private constructor", () => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return
        expect(() => new (PublicKey as any)("foo-bar-baz")).to.throw("PublicKey constructor is private");
      });
      it("should return the same PublicKey from the same SecretKey", () => {
        const sk = SecretKey.deserialize(SECRET_KEY_BYTES);
        const pk1 = sk.toPublicKey();
        const pk2 = sk.toPublicKey();
        expect(pk1.serialize().toString()).to.equal(pk2.serialize().toString());
      });
    });
    describe("serialize", () => {
      it("should default to compressed serialization", () => {
        const sk = SecretKey.deserialize(SECRET_KEY_BYTES);
        const pk = sk.toPublicKey();
        expectEqualHex(pk, pk.serialize(true));
        expectNotEqualHex(pk, pk.serialize(false));
      });
    });
    describe("deserialize", () => {
      it("should only take Uint8Array or Buffer", () => {
        expect(() => PublicKey.deserialize(3 as any)).to.throw("pkBytes must be of type BlstBuffer");
      });
      it("should only take 48 or 96 bytes", () => {
        expect(() => PublicKey.deserialize(Buffer.alloc(32, "*"))).to.throw(
          "pkBytes is 32 bytes, but must be 48 or 96 bytes long"
        );
      });
      it("should take uncompressed byte arrays", () => {
        expectEqualHex(
          PublicKey.deserialize(validPublicKey.uncompressed).serialize(false),
          validPublicKey.uncompressed
        );
      });
      it("should take compressed byte arrays", () => {
        expectEqualHex(PublicKey.deserialize(validPublicKey.compressed), validPublicKey.compressed);
        expectEqualHex(PublicKey.deserialize(validPublicKey.compressed).serialize(true), validPublicKey.compressed);
      });
      it("should throw on invalid key", () => {
        const pkSeed = PublicKey.deserialize(validPublicKey.compressed);
        expect(() =>
          PublicKey.deserialize(Uint8Array.from([...pkSeed.serialize().subarray(0, 46), ...Buffer.from("a1")]))
        ).to.throw("BLST_POINT_NOT_ON_CURVE");
      });
    });
  });
  describe("methods", () => {
    describe("keyValidate()", () => {
      it("should not throw on valid public key", async () => {
        const pk = PublicKey.deserialize(validPublicKey.uncompressed);
        return pk.keyValidate().then((res) => expect(res).to.be.undefined);
      });
    });
    describe("keyValidateSync()", () => {
      it("should not throw on valid public key", async () => {
        const pk = PublicKey.deserialize(validPublicKey.uncompressed);
        expect(pk.keyValidateSync()).to.be.undefined;
      });
    });
  });
});
describe("PublicKeyArg", () => {
  it("should accept compressed serialized key", () => {
    expect(runTest(TestSyncOrAsync.SYNC, TestPhase.SETUP, TestCase.PUBLIC_KEY_ARG, validPublicKey.compressed)).to.equal(
      "VALID_TEST"
    );
  });
  it("should accept uncompressed serialized key", () => {
    expect(
      runTest(TestSyncOrAsync.SYNC, TestPhase.SETUP, TestCase.PUBLIC_KEY_ARG, validPublicKey.uncompressed)
    ).to.equal("VALID_TEST");
  });
  it("should accept PublicKey as argument", () => {
    expect(
      runTest(
        TestSyncOrAsync.SYNC,
        TestPhase.SETUP,
        TestCase.PUBLIC_KEY_ARG,
        PublicKey.deserialize(validPublicKey.uncompressed)
      )
    ).to.equal("VALID_TEST");
  });
  describe("should throw for invalid inputs", () => {
    expect(badPublicKey.length).to.equal(BLST_CONSTANTS.PUBLIC_KEY_LENGTH_UNCOMPRESSED);

    const sk = SecretKey.fromKeygenSync();
    const inputs = [
      ["SecretKey", sk],
      ["Signature", sk.signSync(Buffer.from("test message"))],
    ].concat(invalidInputs);

    for (const [name, input] of inputs) {
      it(`should throw for ${name}`, () => {
        expect(() => runTest(TestSyncOrAsync.SYNC, TestPhase.SETUP, TestCase.PUBLIC_KEY_ARG, input)).to.throw(
          "PublicKeyArg must be a PublicKey instance or a 48/96 byte Uint8Array"
        );
      });
    }
  });
  it("should throw for invalid PublicKey", () => {
    expect(() => runTest(TestSyncOrAsync.SYNC, TestPhase.SETUP, TestCase.PUBLIC_KEY_ARG, badPublicKey)).to.throw(
      "BLST_BAD_ENCODING: Invalid PublicKey"
    );
  });
});
describe("PublicKeyArgArray", () => {
  it("should throw for non-array input", () => {
    expect(() =>
      runTest(TestSyncOrAsync.SYNC, TestPhase.SETUP, TestCase.PUBLIC_KEY_ARG_ARRAY, Buffer.from("valid"))
    ).to.throw("publicKeys must be of type PublicKeyArg[]");
  });
  it("should throw for invalid key", () => {
    expect(badPublicKey.length).to.equal(BLST_CONSTANTS.PUBLIC_KEY_LENGTH_UNCOMPRESSED);
    try {
      runTest(TestSyncOrAsync.SYNC, TestPhase.SETUP, TestCase.PUBLIC_KEY_ARG_ARRAY, [
        validPublicKey.compressed,
        validPublicKey.uncompressed,
        badPublicKey,
      ]);
      throw new Error("function should throw");
    } catch (err) {
      expect((err as Error).message).to.equal("BLST_BAD_ENCODING: Invalid PublicKey at index 2");
    }
  });
});
