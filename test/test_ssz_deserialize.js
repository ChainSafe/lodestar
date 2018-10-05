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

     /** deserializes objects */

     it(`deserialises objects of simple types`, () => {
        let bytesArray = [];
        for(var i = 0; i < 280; i++){
            bytesArray.push(8);
        }

        let valueObject = {
            'publicAddress':hexToBytes('e17cb53f339a726e0b347bbad221ad7b50dc2a30'),
            'secret': hexToBytes('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'),
            'age': 30,
            'distance': 32000,
            'halfLife': 1000000000,
            'file': Buffer.from(bytesArray)
        };

        let fields = {
            'fields':{
                'publicAddress': 'address',
                'secret': 'hash32',
                'age': 'int8',
                'distance': 'int16',
                'halfLife': 'int32',
                'file': 'bytes'
            }
        };

        let result = deserialize(serialize(valueObject, fields), 0, fields);
        assert.deepEqual(result.deserializedData, valueObject);
    
    });

    it(`deserializes objects containing objects`, () => {

        let testObj = new ActiveState();
        let recentHash1 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
        let recentHash2 = 'aa1116bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
        testObj.recentBlockHashes = [
            hexToBytes(recentHash1), 
            hexToBytes(recentHash2)
        ]

        let attestRecord1 = new AttestationRecord(0, 1, Buffer.from([11, 12, 13, 14]));
        let attestRecord2 = new AttestationRecord(2, 3, Buffer.from([255, 254, 253, 252]));
        testObj.pendingAttestations = [
            attestRecord1,
            attestRecord2
        ]

        let result = deserialize(serialize(testObj, ActiveState), 0, ActiveState);
        assert.deepEqual(result.deserializedData, testObj);

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