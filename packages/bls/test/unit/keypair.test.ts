import {PrivateKey,PublicKey,Keypair} from "../../src";
import {expect} from "chai";
import {destroy, init} from "../../src/context";

describe("keypair", function() {

  before(async function () {
    await init();
  });

  after(function () {
    destroy();
  });

  it("should create from private and public key", () => {
    const secret = PrivateKey.random();
    const secret2 = PrivateKey.random();
    const publicKey = PublicKey.fromBytes(PublicKey.fromPrivateKey(secret2).toBytesCompressed());
    const keypair = new Keypair(secret, publicKey);
    expect(keypair.publicKey).to.be.equal(publicKey);
    expect(keypair.privateKey).to.be.equal(secret);
    expect(keypair.privateKey).to.not.be.equal(secret2);
  });

  it("should create from private", () => {
    const secret = PrivateKey.random();
    const publicKey = PublicKey.fromPrivateKey(secret);
    const keypair = new Keypair(secret);
    expect(keypair.publicKey.toBytesCompressed().toString("hex"))
      .to.be.equal(publicKey.toBytesCompressed().toString("hex"));
  });
});
