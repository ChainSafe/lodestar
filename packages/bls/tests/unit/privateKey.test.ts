import {PrivateKey} from "../../src/privateKey";
import {expect} from "chai";
import {SECRET_KEY_LENGTH} from "../../src/constants";

describe('privateKey', function() {

    it('should generate random private key', function () {
        const privateKey1 = PrivateKey.random();
        const privateKey2 = PrivateKey.random();
        expect(privateKey1).to.not.be.equal(privateKey2);
    });

    it('should export private key to hex string', function () {
        const privateKey = '0x9a88071ff0634f6515c7699c97d069dc4b2fa28455f6b457e92d1c1302f0c6bb';
        expect(PrivateKey.fromHexString(privateKey).toHexString()).to.be.equal(privateKey);
    });

    it('should export private key to bytes', function () {
        expect(PrivateKey.random().toBytes().length).to.be.equal(SECRET_KEY_LENGTH);
    });

});
