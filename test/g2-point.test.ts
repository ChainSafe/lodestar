import {G2Point} from '../src/g2-point';
import {expect} from 'chai';
import mcl from "mcl-wasm";

describe('G2Point',  function() {

    before(async () => {
        await mcl.init(mcl.BLS12_381)
    });

    // it('Should be deserialized and serialized in uncompressed form', () => {
    //    const input =
    //        "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF05563F818F87409D27D1C65BAB55DB7CFD498B61050E1ED2FAB7CCB52050B39AEDCEA21A46DCA02553BDAC4D4A72CC54087C8CFE7DBAF1E16223B38B0D6343723B09C73DFC14CF0B1065DA168EA8D3D752BC62DAEB2BC19FB72542150782D957";
    //    const g2 = G2Point.fromBuffer(Buffer.from(input, 'hex'));
    //    expect(g2.toBuffer().toString('hex')).to.be.equal(input);
    // });

    it('Should be deserialized and serialized in compressed form', () => {
        const input =
            "8123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        const g2 = G2Point.fromBufferCompressed(Buffer.from(input, 'hex'));
        expect(g2.toBufferCompressed().toString('hex')).to.be.equal(input);
    });


});
