import {G2point} from "../../../src/helpers/g2point";
import {expect} from "chai";

describe('g2point', function() {

    it('should be equals', () => {
        const g2 = G2point.random();
        expect(g2.equal(g2)).to.be.true;
    });

    it('should not be equals', () => {
        const g2 = G2point.random();
        const g22 = G2point.random();
        expect(g2.equal(g22)).to.be.false;
    });

    it('serialize deserialize should be equal', () => {
        const g2 = G2point.random();
        expect(G2point.fromCompressedBytes(g2.toBytesCompressed()).equal(g2)).to.be.true;
    });

    it('should deserialize from compress', () => {
        const x =
            "8123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
            + "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        expect(() => {
            G2point.fromCompressedBytes(
                Buffer.from(
                    x,
                    'hex'
                )
            )
        }).to.not.throw;
    });

    it('should fail to deserialize', () => {
        const x =
            "800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
            + "1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab";
        expect(() => {
            G2point.fromCompressedBytes(
                Buffer.from(
                    x,
                    'hex'
                )
            )
        }).to.throw('The deserialised X real or imaginary coordinate is too large.');
    });

    it('should fail to deserialize 2', () => {
        const x =
            "9a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab"
            + "000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
        expect(() => {
            G2point.fromCompressedBytes(
                Buffer.from(
                    x,
                    'hex'
                )
            )
        }).to.throw('The deserialised X real or imaginary coordinate is too large.');
    });

    it('should fail to deserialize 3', () => {
        const x =
            "800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
            + "1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaac";
        expect(() => {
            G2point.fromCompressedBytes(
                Buffer.from(
                    x,
                    'hex'
                )
            )
        }).to.throw('The deserialised X real or imaginary coordinate is too large.');
    });

    it('should fail to deserialize 4', () => {
        const x =
            "9a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaac"
            + "000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
        expect(() => {
            G2point.fromCompressedBytes(
                Buffer.from(
                    x,
                    'hex'
                )
            )
        }).to.throw('The deserialised X real or imaginary coordinate is too large.');
    });

    it('should fail to deserialize 5', () => {
        const x =
            "8123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
            + "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde0";
        expect(() => {
            G2point.fromCompressedBytes(
                Buffer.from(
                    x,
                    'hex'
                )
            )
        }).to.throw('X coordinate is not on the curve.');
    });

    it('should fail to deserialize infinity', () => {
        const x =
            "800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
            + "000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
        expect(() => {
            G2point.fromCompressedBytes(
                Buffer.from(
                    x,
                    'hex'
                )
            )
        }).to.throw('X coordinate is not on the curve.');
    });

    it('should fail to deserialize - too few bytes', () => {
        const x = "8123456789abcd";
        expect(() => {
            G2point.fromCompressedBytes(
                Buffer.from(
                    x,
                    'hex'
                )
            )
        }).to.throw('Expected signature of 96 bytes');
    });

    it('should fail to deserialize - too many bytes', () => {
        expect(() => {
            G2point.fromCompressedBytes(
                Buffer.alloc(100, 1),
            )
        }).to.throw('Expected signature of 96 bytes');
    });

    it('should deserialize infinity', () => {
        const x =
            "c00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
            + "000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
        const g2 = G2point.fromCompressedBytes(
            Buffer.from(
                x,
                'hex'
            )
        );
        expect(g2.getPoint().is_infinity()).to.be.true;
    })

});
