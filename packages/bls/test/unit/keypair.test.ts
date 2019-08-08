import {PrivateKey} from "../../src/privateKey";
import {PublicKey} from "../../src/publicKey";
import {Keypair} from "../../src/keypair";
import {expect} from "chai";

describe('keypair', function() {

    it('should create from private and public key', () => {
        const secret = PrivateKey.random();
        const secret2 = PrivateKey.random();
        const publicKey = PublicKey.fromBytes(PublicKey.fromPrivateKey(secret2).toBytesCompressed());
        const keypair = new Keypair(secret, publicKey);
        expect(keypair.publicKey).to.be.equal(publicKey);
        expect(keypair.privateKey).to.be.equal(secret);
        expect(keypair.privateKey).to.not.be.equal(secret2);
    });

    it('should create from private', () => {
        const secret = PrivateKey.random();
        const publicKey = PublicKey.fromPrivateKey(secret);
        const keypair = new Keypair(secret);
        expect(keypair.publicKey.toBytesCompressed().toString('hex'))
            .to.be.equal(publicKey.toBytesCompressed().toString('hex'));
    })
});
