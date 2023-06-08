import {expect} from "chai";
import {PublicKey, SecretKey, Signature} from "../../import";
import {KEY_MATERIAL, SECRET_KEY_BYTES} from "../__fixtures__";
import {expectEqualHex, expectNotEqualHex} from "../utils";

describe("SecretKey", () => {
  it("should exist", () => {
    expect(SecretKey).to.exist;
  });
  describe("constructors", () => {
    describe("new SecretKey()", () => {
      it("should have a private constructor", () => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return
        expect(() => new (SecretKey as any)("foo-bar-baz")).to.throw("SecretKey constructor is private");
      });
    });
    describe("SecretKey.fromKeygenSync", () => {
      it("should create an instance", () => {
        expect(SecretKey.fromKeygenSync()).to.be.instanceOf(SecretKey);
      });
      it("should throw incorrect length ikm", () => {
        expect(() => SecretKey.fromKeygenSync(Buffer.alloc(12, "*"))).to.throw(
          "ikm is 12 bytes, but must be 32 bytes long"
        );
      });
      it("should take valid UintArray8 for ikm", () => {
        expect(SecretKey.fromKeygenSync(KEY_MATERIAL)).to.be.instanceOf(SecretKey);
      });
      it("should create the same key from the same ikm", () => {
        expectEqualHex(SecretKey.fromKeygenSync(KEY_MATERIAL), SecretKey.fromKeygenSync(KEY_MATERIAL));
      });
      it("should take a second 'info' argument", () => {
        expectNotEqualHex(
          SecretKey.fromKeygenSync(KEY_MATERIAL, "some fancy info"),
          SecretKey.fromKeygenSync(KEY_MATERIAL)
        );
      });
    });
    describe("SecretKey.fromKeygen", () => {
      it("should create a Promise<SecretKey>", () => {
        expect(SecretKey.fromKeygen()).to.be.instanceOf(Promise);
        return SecretKey.fromKeygen().then((key) => expect(key).to.be.instanceOf(SecretKey));
      });
      it("should take UintArray8 for ikm", () => {
        return SecretKey.fromKeygen(KEY_MATERIAL).then((key) => expect(key).to.be.instanceOf(SecretKey));
      });
      it("should create the same key from the same ikm", async () => {
        const key1 = await SecretKey.fromKeygen(KEY_MATERIAL);
        const key2 = await SecretKey.fromKeygen(KEY_MATERIAL);
        expectEqualHex(key1, key2);
      });
      it("should take a second 'info' argument", async () => {
        const key1 = await SecretKey.fromKeygen(KEY_MATERIAL, "some fancy info");
        const key2 = await SecretKey.fromKeygen(KEY_MATERIAL);
        expectNotEqualHex(key1, key2);
      });
    });
    describe("SecretKey.deserialize", () => {
      it("should create an instance", () => {
        expect(SecretKey.deserialize(SECRET_KEY_BYTES)).to.be.instanceOf(SecretKey);
      });
    });
  });
  describe("instance methods", () => {
    let key: SecretKey;
    beforeEach(() => {
      key = SecretKey.fromKeygenSync();
    });
    describe("serialize", () => {
      it("should serialize the key to Uint8Array", () => {
        expect(key.serialize()).to.be.instanceof(Uint8Array);
      });
      it("should be 32 bytes long", () => {
        expect(key.serialize().length).to.equal(32);
      });
      it("should reconstruct the same key", () => {
        const serialized = key.serialize();
        expectEqualHex(SecretKey.deserialize(serialized), serialized);
      });
    });
    describe("toPublicKey", () => {
      it("should create a PublicKey", () => {
        expect(SecretKey.fromKeygenSync().toPublicKey()).to.be.instanceOf(PublicKey);
      });
    });
    describe("sign", () => {
      it("should create a Signature", () => {
        const sig = SecretKey.fromKeygenSync().signSync(Buffer.from("some fancy message"));
        expect(sig).to.be.instanceOf(Signature);
      });
    });
  });
});
