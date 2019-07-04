import {expect, assert} from "chai";
import Keystore from "../../../../validator/keystore";
import fs from "fs";

describe("validator/keystore", function() {
  const password = "testingSecret";
  const testFilePath = "keys/validator/testing_file.json";
  let keystore: Keystore;

  after(() => {
    fs.unlinkSync(testFilePath);
  });

  it("Should create keystore class", () => {
    keystore = Keystore.generateKeys(password);
    expect(keystore).to.not.be.undefined;
  });

  it("should generate unique key", () => {
    const newKeystore = Keystore.generateKeys(password);
    assert.notEqual(newKeystore.publicKey, keystore.publicKey);
    assert.notEqual(newKeystore.privateKey(password), keystore.privateKey(password));
  });

  it("should save keystore object to file", () => {
    keystore.saveKeys(testFilePath);
    assert.isTrue(fs.existsSync(testFilePath));
  });

  it("should recreate identical object from generated file", () => {
    const generatedKeys = Keystore.fromJson(testFilePath);
    assert.equal(generatedKeys.publicKey, keystore.publicKey);
    assert.equal(generatedKeys.privateKey(password), keystore.privateKey(password));
  });
});
