import {destroy, init} from "../../src/context";
import {PublicKey, PrivateKey} from "../../src";
import {expect} from "chai";

describe("public key", function () {

  before(async function f() {
    await init();
  });

  after(function () {
    destroy();
  });

  it("from hex", function () {
    const publicKey =
        "0xb6f21199594b56d77670564bf422cb331d5281ca2c1f9a45588a56881d8287ef8619efa6456d6cd2ef61306aa5b21311";
    expect(PublicKey.fromHex(publicKey).toHexString()).to.be.equal(publicKey);
  });

  it("from bytes", function () {
    const publicKey =
        "b6f21199594b56d77670564bf422cb331d5281ca2c1f9a45588a56881d8287ef8619efa6456d6cd2ef61306aa5b21311";
    expect(PublicKey.fromBytes(Buffer.from(publicKey, "hex")).toHexString()).to.be.equal(`0x${publicKey}`);
  });

  it("from private key", function () {
    PublicKey.fromPrivateKey(PrivateKey.random());
  });
    
});