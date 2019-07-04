import {assert, expect} from "chai";

import {encryptKey, decryptKey} from "../../../util/encrypt";

describe("util/encrypt", function() {
  const password = "testSecret";
  const encryptedZero = "08c22db382676ba2343f1504c8024c0e";
  const encryptedHex = "aae7fcea7f0d218dc635b7cfd4594b29";

  it("should encrypt and decrypt to same value", () => {
    const value = "0x8610e6f1ba22190bd6e6f4f541747199e49bad17c1a67c442ed661fabf8e174c";
    const encrypted = encryptKey(value, password);

    assert.equal(decryptKey(encrypted, password), value);

    expect(
      () => decryptKey(encrypted, "wrongpassword")
    ).to.throw(Error, "Invalid key or password to decode");
  });

  describe("encryptKey", () => {
    it("should encrypt 0x00", () => {
      assert.equal(encryptKey("0x00", password), encryptedZero);
    });
    it("should encrypt 0xa88c", () => {
      assert.equal(encryptKey("0xa88c", password), encryptedHex);
    });
  });

  describe("decryptKey", () => {
    it("should decrypt to 0x00", () => {
      assert.equal(decryptKey(encryptedZero, password), "0x00");
    });
    it("should decrypt 0xa88c", () => {
      assert.equal(decryptKey(encryptedHex, password), "0xa88c", "test");
    });
  });
});
