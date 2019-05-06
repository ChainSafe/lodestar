import {G1point} from "../../../src/helpers/g1point";
import {expect} from "chai";

describe('g1point', function() {

    it('should generate different random point', () => {
        const g1 = G1point.random();
        const g2 = G1point.random();
        expect(g1.equal(g2)).to.be.false;
    });

    it('should be same', () => {
        const g1 = G1point.random();
        expect(g1.equal(g1)).to.be.true;
    });

    it('serialize adn deserialize should produce same result', () => {
        const g1 = G1point.random();
        const g2 = G1point.fromBytesCompressed(g1.toBytesCompressed());
        expect(g1.equal(g2)).to.be.true;
    });

    it('deserialize correct point doesn not throw', () => {
        expect(() => {
            G1point.fromBytesCompressed(
                Buffer.from(
                    '8123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
                    'hex'
                )
            )
        }).to.not.throw;
    });

    it('deserialize incorrect point throws', () => {
        expect(() => {
            G1point.fromBytesCompressed(
                Buffer.from(
                    '8123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde0',
                    'hex'
                )
            )
        }).to.throw('X coordinate is not on the curve.');
    });

    it('deserialize incorrect point throws 2', () => {
        expect(() => {
            G1point.fromBytesCompressed(
                Buffer.from(
                    '9a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab',
                    'hex'
                )
            )
        }).to.throw('X coordinate is too large.');
    });

    it('deserialize incorrect point throws 3', () => {
        expect(() => {
            G1point.fromBytesCompressed(
                Buffer.from(
                    '9a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaac',
                    'hex'
                )
            )
        }).to.throw('X coordinate is too large.');
    });

    it('deserialize incorrect point throws to few bytes', () => {
        expect(() => {
            G1point.fromBytesCompressed(
                Buffer.from(
                    '9a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaa',
                    'hex'
                )
            )
        }).to.throw('Expected g1 compressed input to have 48 bytes');
    });

    it('deserialize incorrect point throws to many bytes', () => {
        expect(() => {
            G1point.fromBytesCompressed(
                Buffer.from(
                    '9a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaa900',
                    'hex'
                )
            )
        }).to.throw('Expected g1 compressed input to have 48 bytes');
    });

    it('deserialize infinity', () => {
        const g1 = G1point.fromBytesCompressed(
            Buffer.from(
                'c00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                'hex'
            )
        );
        expect(g1.getPoint().is_infinity()).to.be.true
    });

    it('wrong infinity serialization', () => {
        expect(() => {
            G1point.fromBytesCompressed(
                Buffer.from(
                    'e00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                    'hex'
                )
            )
        }).to.throw('The serialised input has B flag set, but A flag is set, or X is non-zero.');
    });
});
