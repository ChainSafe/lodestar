import bls from "../../src";
import {Keypair} from "../../src/keypair";
import hash from "keccak256";
import {G2point} from "../../src/helpers/g2point";
import {expect} from "chai";

describe('test bls', function () {

    it('should verify signature', () => {
        const keypair = Keypair.generate();
        const messageHash = hash("Test message");
        const domain = Buffer.from("01", 'hex');
        const signature = keypair.privateKey.sign(
            G2point.hashToG2(messageHash, domain)
        );
        const result = bls.verify(
            keypair.publicKey.toBytesCompressed(),
            messageHash,
            signature.toBytesCompressed(),
            domain
        );
        expect(result).to.be.true;
    });

    it('should fail verify signature of different message', () => {
        const keypair = Keypair.generate();
        const messageHash = hash("Test message");
        const messageHash2 = hash("Test message2");
        const domain = Buffer.from("01", 'hex');
        const signature = keypair.privateKey.sign(
            G2point.hashToG2(messageHash, domain)
        );
        const result = bls.verify(
            keypair.publicKey.toBytesCompressed(),
            messageHash2,
            signature.toBytesCompressed(),
            domain
        );
        expect(result).to.be.false;
    });

    it('should fail verify signature signed by different key', () => {
        const keypair = Keypair.generate();
        const keypair2 = Keypair.generate();
        const messageHash = hash("Test message");
        const domain = Buffer.from("01", 'hex');
        const signature = keypair.privateKey.sign(
            G2point.hashToG2(messageHash, domain)
        );
        const result = bls.verify(
            keypair2.publicKey.toBytesCompressed(),
            messageHash,
            signature.toBytesCompressed(),
            domain
        );
        expect(result).to.be.false;
    });

});
