const assert = require('chai').assert;
const readIntBytes = require('../src/intBytes').readIntBytes;
const intByteLength = require('../src/intBytes').intByteLength;
const serialize = require('../src/simpleSerialize').serialize;

describe('SimpleSerialize', () => {

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
        let intResult = result.readUInt8(0);

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
        let intResult = result.readUInt16BE(0);

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
        let intResult = result.readUInt32BE(0);

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
        let bytesInput = Buffer.from(bytesArray);
        let result = serialize(bytesInput, 'bytes');

        assert.isNotNull(result);
        assert.equal(result.readUInt32BE(0), bytesInput.byteLength)
        let bytesResult = result.slice(4);
        assert.deepEqual(bytesResult, bytesInput);

    });

    /** serializes arrays of elements (of same type) */


    it(`serializes arrays of elements (of the same type) - hash32`, () => {

        let arrayInput = [
            hexToBytes('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'),
            hexToBytes('dd7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015bb')
        ];
        let result = serialize(arrayInput, ['hash32']);

        let flatInput = [...new Uint8Array(arrayInput[0]), ...new Uint8Array(arrayInput[1])];
        let expectedLength = 4 + flatInput.length; // (length + bytes)

        assert.isNotNull(result);

        assert.equal(result.readUInt32BE(0), expectedLength)
        
        let arrayResult = result.slice(4);
        assert.deepEqual(arrayResult, new Uint8Array(flatInput));

    });

    it(`serializes arrays of elements (of the same type) - address`, () => {

        let arrayInput = [
            hexToBytes('e17cb53f339a726e0b347bbad221ad7b50dc2a30'),
            hexToBytes('ccccb53f339a726e0b347bbad221ad7b50daaaaa')
        ];
        let result = serialize(arrayInput, ['address']);

        let flatInput = [...new Uint8Array(arrayInput[0]), ...new Uint8Array(arrayInput[1])];
        let expectedLength = 4 + flatInput.length; // (length + bytes)

        assert.isNotNull(result);
    
        assert.equal(result.readUInt32BE(0), expectedLength)
        
        let arrayResult = result.slice(4);
        assert.deepEqual(arrayResult, new Uint8Array(flatInput));

    });

    it(`serializes arrays of elements (of the same type) - int8`, () => {

        scenarioTestArrayOfInts([1, 2, 3], 'int8');

    });

    it(`serializes arrays of elements (of the same type) - int16`, () => {

        scenarioTestArrayOfInts([32000, 32001, 32002], 'int16');

    });

    it(`serializes arrays of elements (of the same type) - int32`, () => {

        scenarioTestArrayOfInts([1000000000, 1000000001, 1000000002], 'int32');

    });

    it(`errors when serializing array, given more than one element type provided`, () =>{

        assert.throws(
            () => serialize([1,2], ['int32', 'int8']),
            Error,
            `array type should only have one element type`
        );

    });

    it(`serialises objects of simple types`, () => {
        let addressValue = 'e17cb53f339a726e0b347bbad221ad7b50dc2a30';
        let hashValue = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
        let int8Value = 30;
        let int16Value = 32000;
        let int32Value = 1000000000;

        let bytesArray = [];
        for(var i = 0; i < 280; i++){
            bytesArray.push(8);
        }
        let bytesValue = Buffer.from(bytesArray);

        let result = serialize(
            {
                'publicAddress':hexToBytes(addressValue),
                'secret': hexToBytes(hashValue),
                'age': int8Value,
                'distance': int16Value,
                'halfLife': int32Value,
                'file': bytesValue
            },
            {
                'fields':{
                    'publicAddress': 'address',
                    'secret': 'hash32',
                    'age': 'int8',
                    'distance': 'int16',
                    'halfLife': 'int32',
                    'file': 'bytes'
                }
            }
        );
        
        let offset = 0;

        // assert byte length
        let expectedByteLength = 343;
        let actualByteLength = result.readInt32BE(offset);
        offset += 4;
        console.log(actualByteLength)
        assert.equal(actualByteLength, expectedByteLength, 'Byte length is not correct');

        // assert address value
        let actualAddress = result.slice(offset, (offset + 20));
        offset += 20;
        assert.equal(actualAddress.toString('hex'), addressValue, 'Address type not serialised correctly');

        // assert hash value
        let actualHash = result.slice(offset, (offset + 32));
        offset += 32;
        assert.equal(actualHash.toString('hex'), hashValue, 'Hash32 type not serialised correctly');

        // assert int8 value
        let actualInt8 = result.readUInt8(offset);
        offset += 1;
        assert.equal(actualInt8, int8Value, 'Int8 value not serialised correctly');
        
        // assert int16 value
        let actualInt16 = result.readUInt16BE(offset);
        offset += 2;
        assert.equal(actualInt16, int16Value, 'Int16 value not serialised correctly');

        // assert int32 value
        let actualInt32 = result.readUInt32BE(offset);
        offset += 4;
        assert.equal(actualInt32, int32Value, 'Int32 value not serialised correctly');

        // assert bytes value
        let actualBytesLength = result.readUInt32BE(offset);
        assert.equal(actualBytesLength, 280);
        offset += 4;
        let actualBytes = result.slice(offset, (offset + 280));
        offset += 280;
        assert.equal(actualBytes.toString('hex'), bytesValue.toString('hex'), 'Bytes type not serialised correctly');
    });

    xit(`serializes objects containing objects`);


    function scenarioTestArrayOfInts(arrayInput, type){
        let result = serialize(arrayInput, [type]);

        assert.isNotNull(result);
        let lengthResult = result.readUInt32BE(0);
        assert.equal(lengthResult, (4 + arrayInput.length * intByteLength(type)));
        let resultView = result.slice(4);
        let inputIndex = 0;
        for(var i = 0; i < (result.byteLength-4); i+=intByteLength(type)) {
            assert.equal(readIntBytes(type)(resultView, i), arrayInput[inputIndex++]);
        }
        
    }


    // TODO - move into utils
    /**
     * Convert a hex string to a byte array
     *
     * @method hexToBytes
     * @param {string} hex
     * @return {Uint8Array} the byte array
     */
    function hexToBytes(hex) {
        hex = hex.toString(16);

        hex = hex.replace(/^0x/i,'');

        let bytes = new Uint8Array(hex.length/2);
        for (var i = 0, c = 0; c < hex.length; c += 2, i += 1){
            bytes[i] = parseInt(hex.substr(c, 2), 16);
        }
        return Buffer.from(bytes.buffer);
    };


});