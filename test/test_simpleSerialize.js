const assert = require('chai').assert;
const serialize = require('../src/simpleSerialize').serialize;

describe('SimpleSerialize', () => {

    it(`does something with null type`);

    /** hash32 */

	it(`successfully serializes hash32`, () => {        
        
        let hashInput = hexToBytes('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
        let result = serialize(hashInput, 'hash32');

        assert.isNotNull(result, 'hash32 result should not be null');
        assert.equal(result, hashInput, 'hash32 result should be same as input');

    });

    it(`errors when serializing hash32, given hash less than 32 bytes`, () => {
        
        let hashWithIncorrectLength = hexToBytes('ba7816bf8f01cfea414140de5dae2223'); 
        
        assert.throws(
            () => serialize(hashWithIncorrectLength, 'hash32'),
            Error,
            `given hash32 ${hashWithIncorrectLength} should be 32 bytes`
        );

    });

    it(`errors when serializing hash32, given hash greater than 32 bytes`, () => {
        
        let hashWithIncorrectLength = hexToBytes('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015addfsdfds'); 
        
        assert.throws(
            () => serialize(hashWithIncorrectLength, 'hash32'),
            Error,
            `given hash32 ${hashWithIncorrectLength} should be 32 bytes`
        );

    });

    /** addresses */

    it(`serializes addresses`, () => {        
        
        let addressInput = hexToBytes('e17cb53f339a726e0b347bbad221ad7b50dc2a30');
        let result = serialize(addressInput, 'address');

        assert.isNotNull(result, 'address result should not be null');
        assert.equal(result, addressInput, 'address result should be same as input');

    });
    
    it(`errors when serializing address, given address less than 20 bytes`, () => {
        
        let addressWithIncorrectLength = hexToBytes('e17cb53f339a726e0b34'); 
        
        assert.throws(
            () => serialize(addressWithIncorrectLength, 'address'),
            Error,
            `given address ${addressWithIncorrectLength} should be 20 bytes`
        );

    });

    it(`errors when serializing address, given address greater than 20 bytes`, () => {
        
        let addressWithIncorrectLength = hexToBytes('e17cb53f339a726e0b347bbad221ad7b50dc2a300000000');
        
        assert.throws(
            () => serialize(addressWithIncorrectLength, 'address'),
            Error,
            `given address ${addressWithIncorrectLength} should be 20 bytes`
        );

    });

    /** integers */

    it(`serializes int8`, () => {        
        
        let intInput = 5;
        let result = serialize(intInput, 'int8');
        let intResult = new DataView(result).getUint8(0);

        assert.isNotNull(result, 'int8 result should not be null');
        assert.equal(intResult, intInput, 'int8 result should be same as input');

    });

    it(`errors when serializing int8, given int larger than 255`, () => {
        
        let intInput = 256;
        assert.throws(
            () => serialize(intInput, 'int8'),
            Error,
            `given value is too large for type size int8`
        );

    });

    it(`serializes int16`, () => {        
        
        let intInput = 32000;
        let result = serialize(intInput, 'int16');
        let intResult = new DataView(result).getUint16(0);

        assert.isNotNull(result, 'int16 result should not be null');
        assert.equal(intResult, intInput, 'int16 result should be same as input');

    });

    it(`errors when serializing int16, given int larger than 32767`, () => {
        
        let intInput = 32768;
        assert.throws(
            () => serialize(intInput, 'int16'),
            Error,
            `given value is too large for type size int16`
        );

    });

    it(`serializes int32`, () => {        
        
        let intInput = 1000000000;
        let result = serialize(intInput, 'int32');
        let intResult = new DataView(result).getUint32(0);

        assert.isNotNull(result, 'int32 result should not be null');
        assert.equal(intResult, intInput, 'int32 result should be same as input');

    });

    it(`errors when serializing int16, given int larger than 2147483647`, () => {
        
        let intInput = 2147483648;
        assert.throws(
            () => serialize(intInput, 'int32'),
            Error,
            `given value is too large for type size int32`
        );

    });

    /** bytes */

    it(`serializes bytes`, () => {        
        
        let bytesArray = [];
        for(var i = 0; i < 280; i++){
            bytesArray.push(1);
        }
        let bytesInput = Uint8Array.from(bytesArray);
        let result = serialize(bytesInput.buffer, 'bytes');

        assert.isNotNull(result);
        let lengthResult = new DataView(result, 0);
        assert.equal(lengthResult.getUint32(0), bytesInput.byteLength)
        let bytesResult = new Uint8Array(result, 4);
        assert.deepEqual(bytesResult, bytesInput);

    });


    // TODO - move into utils
    /**
     * Convert a hex string to a byte array
     *
     * @method hexToBytes
     * @param {string} hex
     * @return {Uint8Array} the byte array
     */
    var hexToBytes = function(hex) {
        hex = hex.toString(16);

        hex = hex.replace(/^0x/i,'');

        let bytes = new Uint8Array(hex.length/2);
        for (var i = 0, c = 0; c < hex.length; c += 2, i += 1){
            bytes[i] = parseInt(hex.substr(c, 2), 16);
        }
        return bytes;
    };


});