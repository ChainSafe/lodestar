const assert = require('chai').assert;
const hexToBytes = require('./utils/hexToBytes').hexToBytes;
const readIntBytes = require('../src/intBytes').readIntBytes;
const intByteLength = require('../src/intBytes').intByteLength;
const ActiveState = require('./utils/activeState').ActiveState;
const AttestationRecord = require('./utils/activeState').AttestationRecord;
const serialize = require('../src').serialize;
const deserialize = require('../src').deserialize;

describe('SimpleSerialize - deserialize', () => {

    it(`deserializes hash32`, () => {

        let hashInput = hexToBytes('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
        let result = deserialize(serialize(hashInput, 'hash32'), 0, 'hash32');

        assert.isNotNull(result, 'hash32 result should not be null');
        assert.equal(result.deserializedData.toString('hex'), hashInput.toString('hex'), 'hash32 result should be same as input');
        assert.equal(result.offset, 32, 'Offset is should be 32')
    
    });

    it(`deserializes addresses`, () => {        
        
        let addressInput = hexToBytes('e17cb53f339a726e0b347bbad221ad7b50dc2a30');
        let result = deserialize(serialize(addressInput, 'address'), 0, 'address');

        assert.isNotNull(result, 'address result should not be null');
        assert.equal(result.deserializedData.toString('hex'), addressInput.toString('hex'), 'address result should be same as input');
        assert.equal(result.offset, 20, 'Offset is should be 20')

    });

    /** integers */

    it(`deserializes int8`, () => {        
        
        let intInput = 5;
        let result = deserialize(serialize(intInput, 'int8'), 0, 'int8');

        assert.isNotNull(result, 'int8 result should not be null');
        assert.equal(result.deserializedData, intInput, 'int8 result should be same as input');
        assert.equal(result.offset, 1, 'Offset should be 1 byte');

    });

    it(`deserializes int16`, () => {        
        
        let intInput = 32000;
        let result = deserialize(serialize(intInput, 'int16'), 0, 'int16');

        assert.isNotNull(result, 'int16 result should not be null');
        assert.equal(result.deserializedData, intInput, 'int16 result should be same as input');
        assert.equal(result.offset, 2, 'Offset should be 2 bytes');

    });

    it(`deserializes int32`, () => {        
        
        let intInput = 1000000000;
        let result = deserialize(serialize(intInput, 'int32'), 0, 'int32');

        assert.isNotNull(result, 'int32 result should not be null');
        assert.equal(result.deserializedData, intInput, 'int32 result should be same as input');
        assert.equal(result.offset, 4, 'Offset should be 4 bytes');

    });


    /** bytes */

    it(`deserializes bytes`, () => {        
        
        let bytesArray = [];
        for(var i = 0; i < 280; i++){
            bytesArray.push(1);
        }
        let bytesInput = Buffer.from(bytesArray);
        let result = deserialize(serialize(bytesInput, 'bytes'), 0, 'bytes');

        assert.isNotNull(result);
        assert.deepEqual(result.deserializedData.toString('hex'), bytesInput.toString('hex'));
        assert.equal(result.offset, 4 + bytesInput.byteLength, 'Offset should be int32 bytes (4) + byte input length');
    });

    /** arrays */

    it(`deserializes arrays of elements (of the same type) - hash32`, () => {

        scenarioDeserializeByteArrays(
            [
                hexToBytes('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'),
                hexToBytes('dd7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015bb')
            ],
            'hash32'
        );

    });

    it(`deserializes arrays of elements (of the same type) - address`, () => {

        scenarioDeserializeByteArrays(
            [
                hexToBytes('e17cb53f339a726e0b347bbad221ad7b50dc2a30'),
                hexToBytes('ccccb53f339a726e0b347bbad221ad7b50daaaaa')
            ],
            'address'
        );

    });

    it(`deserializes arrays of elements (of the same type) - int8`, () => {
        scenarioDeserializeIntArrays(
            [1, 2, 3],
            'int8'
        );
    });

    it(`deserializes arrays of elements (of the same type) - int16`, () => {
        scenarioDeserializeIntArrays(
            [32000, 32001, 32002],
            'int16'
        );
    });

    it(`deserializes arrays of elements (of the same type) - int32`, () => {
        scenarioDeserializeIntArrays(
            [1000000000, 1000000001, 1000000002],
            'int32'
        );
    });

    function scenarioDeserializeByteArrays(arrayInput, type) {
        let result = deserialize(serialize(arrayInput, [type]), 0, [type]);

        let flatInput = Buffer.from([...arrayInput[0], ...arrayInput[1]]);
        let expectedLength = flatInput.length;

        assert.isNotNull(result);
        assert.deepEqual(result.deserializedData, arrayInput);
        assert.equal(result.offset, 4 + expectedLength, 'Offset should be int32 bytes (4) + array bytes length');
    }

    function scenarioDeserializeIntArrays(arrayInput, type){
        let result = deserialize(serialize(arrayInput, [type]), 0, [type]);

        assert.isNotNull(result);
        assert.deepEqual(result.deserializedData, arrayInput, 'Array of integers not deserialized correctly');
        assert.equal(result.offset, 4 + intByteLength(type) * arrayInput.length, `Offset should be length (4 bytes) + (${intByteLength(type)} * number of elements)`);
    }

});