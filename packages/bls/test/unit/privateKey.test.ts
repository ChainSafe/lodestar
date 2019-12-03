import {PrivateKey} from "../../src";
import {expect} from "chai";
import {SECRET_KEY_LENGTH} from "../../src/constants";
import {destroy, init} from "../../src/context";

describe("privateKey", function() {

  before(async function () {
    await init();
  });

  after(function () {
    destroy();
  });

  it("should generate random private key", function () {
    const privateKey1 = PrivateKey.random();
    const privateKey2 = PrivateKey.random();
    expect(privateKey1.toHexString()).to.not.be.equal(privateKey2.toHexString());
  });

  it("should export private key to hex string", function () {
    const privateKey = "0x07656fd676da43883d163f49566c72b9cbf0a5a294f26808c807700732456da7";

    expect(PrivateKey.fromHexString(privateKey).toHexString()).to.be.equal(privateKey);

    const privateKey2 = "07656fd676da43883d163f49566c72b9cbf0a5a294f26808c807700732456da7";

    expect(PrivateKey.fromHexString(privateKey2).toHexString()).to.be.equal(privateKey);
  });

  it("should export private key to bytes", function () {
    expect(PrivateKey.random().toBytes().length).to.be.equal(SECRET_KEY_LENGTH);
  });
  
  it("should not accept too short private key", function () {
    expect(() => PrivateKey.fromHexString("0x2123")).to.throw();
  });

});
