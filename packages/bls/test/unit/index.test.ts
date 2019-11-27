import bls, {aggregatePubkeys, aggregateSignatures, initLibrary, Keypair, verify, verifyMultiple} from "../../src";
import {sha256} from "js-sha256";
import {expect} from "chai";
import {destroy} from "../../src/context";
import {padLeft} from "../../lib/helpers/utils";

describe("test bls", function () {

  before(async function() {
    await initLibrary();
  });

  after(function () {
    destroy();
  });

  describe("aggregate pubkey", function () {
    it("should aggregate empty array", function () {
      expect(bls.aggregatePubkeys([])).to.not.throw;
    });
  });

  describe("verify", function() {
    it("should verify signature", () => {
      const keypair = Keypair.generate();
      const messageHash = Buffer.from(sha256.arrayBuffer("Test"));
      const domain = Buffer.alloc(8, 1);
      const signature = keypair.privateKey.signMessage(
        messageHash,
        domain
      );
      const result = verify(
        keypair.publicKey.toBytesCompressed(),
        messageHash,
        signature.toBytesCompressed(),
        domain
      );
      expect(result).to.be.true;
    });


    it("should not modify original pubkey when verifying", () => {
      const keypair = Keypair.generate();
      const messageHash = Buffer.from(sha256.arrayBuffer("Test"));
      const domain = Buffer.alloc(8, 1);
      const signature = keypair.privateKey.signMessage(
        messageHash,
        domain
      );
      const pubKey = keypair.publicKey.toBytesCompressed();
      verify(
        pubKey,
        messageHash,
        signature.toBytesCompressed(),
        domain
      );
      expect("0x" + pubKey.toString("hex")).to.be.equal(keypair.publicKey.toHexString());
    });


    it("should fail verify empty signature", () => {
      const keypair = Keypair.generate();
      const messageHash2 = Buffer.from(sha256.arrayBuffer("Test message2"));
      const domain = Buffer.from("01", "hex");
      const signature = Buffer.alloc(96);
      const result = verify(
        keypair.publicKey.toBytesCompressed(),
        messageHash2,
        signature,
        domain
      );
      expect(result).to.be.false;
    });

    it("should fail verify signature of different message", () => {
      const keypair = Keypair.generate();
      const messageHash = Buffer.from(sha256.arrayBuffer("Test message"));
      const messageHash2 = Buffer.from(sha256.arrayBuffer("Test message2"));
      const domain = padLeft(Buffer.from("01", "hex"), 8);
      const signature = keypair.privateKey.signMessage(
        messageHash,
        domain
      );
      const result = verify(
        keypair.publicKey.toBytesCompressed(),
        messageHash2,
        signature.toBytesCompressed(),
        domain
      );
      expect(result).to.be.false;
    });

    it("should fail verify signature of different domain", () => {
      const keypair = Keypair.generate();
      const messageHash = Buffer.from(sha256.arrayBuffer("Test message"));
      const domain = padLeft(Buffer.from("01", "hex"), 8);
      const domain2 = padLeft(Buffer.from("02", "hex"), 8);
      const signature = keypair.privateKey.signMessage(
        messageHash,
        domain
      );
      const result = verify(
        keypair.publicKey.toBytesCompressed(),
        messageHash,
        signature.toBytesCompressed(),
        domain2
      );
      expect(result).to.be.false;
    });

    it("should fail verify signature signed by different key", () => {
      const keypair = Keypair.generate();
      const keypair2 = Keypair.generate();
      const messageHash = Buffer.from(sha256.arrayBuffer("Test message"));
      const domain = Buffer.from("01", "hex");
      const signature = keypair.privateKey.signMessage(
        messageHash,
        domain
      );
      const result = verify(
        keypair2.publicKey.toBytesCompressed(),
        messageHash,
        signature.toBytesCompressed(),
        domain
      );
      expect(result).to.be.false;
    });
  });

  describe("verify multiple", function() {

    it("should verify aggregated signatures", function () {
      this.timeout(5000);


      const domain = Buffer.alloc(8, 0);

      const keypair1 = Keypair.generate();
      const keypair2 = Keypair.generate();
      const keypair3 = Keypair.generate();
      const keypair4 = Keypair.generate();

      const message1 = Buffer.from(sha256.arrayBuffer("Test1"));
      const message2 = Buffer.from(sha256.arrayBuffer("Test2"));

      const signature1 = keypair1.privateKey.signMessage(message1, domain);
      const signature2 = keypair2.privateKey.signMessage(message1, domain);
      const signature3 = keypair3.privateKey.signMessage(message2, domain);
      const signature4 = keypair4.privateKey.signMessage(message2, domain);

      const aggregatePubKey12 = aggregatePubkeys([
        keypair1.publicKey.toBytesCompressed(),
        keypair2.publicKey.toBytesCompressed(),
      ]);

      const aggregatePubKey34 = aggregatePubkeys([
        keypair3.publicKey.toBytesCompressed(),
        keypair4.publicKey.toBytesCompressed(),
      ]);

      const aggregateSignature = aggregateSignatures([
        signature1.toBytesCompressed(),
        signature2.toBytesCompressed(),
        signature3.toBytesCompressed(),
        signature4.toBytesCompressed(),
      ]);

      const result = verifyMultiple(
        [aggregatePubKey12, aggregatePubKey34],
        [message1, message2],
        aggregateSignature,
        domain
      );

      expect(result).to.be.true;
    });

    it("should verify aggregated signatures - same message", function () {
      this.timeout(5000);


      const domain = Buffer.alloc(8, 0);

      const keypair1 = Keypair.generate();
      const keypair2 = Keypair.generate();
      const keypair3 = Keypair.generate();
      const keypair4 = Keypair.generate();

      const message = Buffer.from(sha256.arrayBuffer("Test1"));

      const signature1 = keypair1.privateKey.signMessage(message, domain);
      const signature2 = keypair2.privateKey.signMessage(message, domain);
      const signature3 = keypair3.privateKey.signMessage(message, domain);
      const signature4 = keypair4.privateKey.signMessage(message, domain);

      const aggregateSignature = aggregateSignatures([
        signature1.toBytesCompressed(),
        signature2.toBytesCompressed(),
        signature3.toBytesCompressed(),
        signature4.toBytesCompressed(),
      ]);

      const result = verifyMultiple(
        [
          keypair1.publicKey.toBytesCompressed(),
          keypair2.publicKey.toBytesCompressed(),
          keypair3.publicKey.toBytesCompressed(),
          keypair4.publicKey.toBytesCompressed()
        ],
        [message, message, message, message],
        aggregateSignature,
        domain
      );

      expect(result).to.be.true;
    });

    it("should fail to verify aggregated signatures - swapped messages", function () {
      this.timeout(5000);

      const domain = Buffer.alloc(8, 0);

      const keypair1 = Keypair.generate();
      const keypair2 = Keypair.generate();
      const keypair3 = Keypair.generate();
      const keypair4 = Keypair.generate();

      const message1 = Buffer.from(sha256.arrayBuffer("Test1"));
      const message2 = Buffer.from(sha256.arrayBuffer("Test2"));

      const signature1 = keypair1.privateKey.signMessage(message1, domain);
      const signature2 = keypair2.privateKey.signMessage(message1, domain);
      const signature3 = keypair3.privateKey.signMessage(message2, domain);
      const signature4 = keypair4.privateKey.signMessage(message2, domain);

      const aggregatePubKey12 = bls.aggregatePubkeys([
        keypair1.publicKey.toBytesCompressed(),
        keypair2.publicKey.toBytesCompressed(),
      ]);

      const aggregatePubKey34 = bls.aggregatePubkeys([
        keypair3.publicKey.toBytesCompressed(),
        keypair4.publicKey.toBytesCompressed(),
      ]);

      const aggregateSignature = bls.aggregateSignatures([
        signature1.toBytesCompressed(),
        signature2.toBytesCompressed(),
        signature3.toBytesCompressed(),
        signature4.toBytesCompressed(),
      ]);

      const result = bls.verifyMultiple(
        [aggregatePubKey12, aggregatePubKey34],
        [message2, message1],
        aggregateSignature,
        domain
      );

      expect(result).to.be.false;
    });

    it("should fail to verify aggregated signatures - different pubkeys and messsages", () => {

      const domain = Buffer.alloc(8, 0);

      const keypair1 = Keypair.generate();
      const keypair2 = Keypair.generate();
      const keypair3 = Keypair.generate();
      const keypair4 = Keypair.generate();

      const message1 = Buffer.from(sha256.arrayBuffer("Test1"));
      const message2 = Buffer.from(sha256.arrayBuffer("Test2"));

      const signature1 = keypair1.privateKey.signMessage(message1, domain);
      const signature2 = keypair2.privateKey.signMessage(message1, domain);
      const signature3 = keypair3.privateKey.signMessage(message2, domain);
      const signature4 = keypair4.privateKey.signMessage(message2, domain);

      const aggregatePubKey12 = bls.aggregatePubkeys([
        keypair1.publicKey.toBytesCompressed(),
        keypair2.publicKey.toBytesCompressed(),
      ]);


      const aggregateSignature = bls.aggregateSignatures([
        signature1.toBytesCompressed(),
        signature2.toBytesCompressed(),
        signature3.toBytesCompressed(),
        signature4.toBytesCompressed(),
      ]);

      const result = bls.verifyMultiple(
        [aggregatePubKey12],
        [message2, message1],
        aggregateSignature,
        domain
      );

      expect(result).to.be.false;
    });

    it("should fail to verify aggregated signatures - different domain", () => {

      const domain = Buffer.alloc(8, 0);
      const domain2 = Buffer.alloc(8, 1);

      const keypair1 = Keypair.generate();
      const keypair2 = Keypair.generate();
      const keypair3 = Keypair.generate();
      const keypair4 = Keypair.generate();

      const message1 = Buffer.from(sha256.arrayBuffer("Test1"));
      const message2 = Buffer.from(sha256.arrayBuffer("Test2"));

      const signature1 = keypair1.privateKey.signMessage(message1, domain);
      const signature2 = keypair2.privateKey.signMessage(message1, domain);
      const signature3 = keypair3.privateKey.signMessage(message2, domain2);
      const signature4 = keypair4.privateKey.signMessage(message2, domain2);

      const aggregatePubKey12 = bls.aggregatePubkeys([
        keypair1.publicKey.toBytesCompressed(),
        keypair2.publicKey.toBytesCompressed(),
      ]);


      const aggregateSignature = bls.aggregateSignatures([
        signature1.toBytesCompressed(),
        signature2.toBytesCompressed(),
        signature3.toBytesCompressed(),
        signature4.toBytesCompressed(),
      ]);

      const result = bls.verifyMultiple(
        [aggregatePubKey12],
        [message2, message1],
        aggregateSignature,
        domain
      );

      expect(result).to.be.false;
    });


    it("should fail to verify aggregated signatures - no public keys", () => {

      const domain = Buffer.alloc(8, 0);

      const signature = Buffer.alloc(96);

      const message1 = Buffer.from(sha256.arrayBuffer("Test1"));
      const message2 = Buffer.from(sha256.arrayBuffer("Test2"));

      const result = bls.verifyMultiple(
        [],
        [message2, message1],
        signature,
        domain
      );

      expect(result).to.be.false;
    });

  });

});
