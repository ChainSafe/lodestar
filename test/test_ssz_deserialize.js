const assert = require('chai').assert;
const BN = require('bn.js');
const hexToBytes = require('./utils/hexToBytes').hexToBytes;
const intByteLength = require('../src/intBytes').intByteLength;
const ActiveState = require('./utils/activeState').ActiveState;
const AttestationRecord = require('./utils/activeState').AttestationRecord;
const serialize = require('../src').serialize;
const deserialize = require('../src').deserialize;

describe(`SimpleSerialize - deserializes boolean`, () => {

    it(`deserializes boolean true value`, () => {

        let boolInput = true;
        let result = deserialize(serialize(boolInput, 'bool'), 0, 'bool');

        assert.equal(result.deserializedData, boolInput);
    });

    it(`deserializes boolean false value`, () => {

        let boolInput = false;
        let result = deserialize(serialize(boolInput, 'bool'), 0, 'bool');

        assert.equal(result.deserializedData, boolInput);
    });

});


describe(`SimpleSerialize - deserializes hash32, hash96, hash97`, () => {

    it(`deserializes hash32`, () => {

        let hashInput = hexToBytes('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
        let result = deserialize(serialize(hashInput, 'hash32'), 0, 'hash32');

        assert.isNotNull(result, 'hash32 result should not be null');
        assert.equal(result.deserializedData.toString('hex'), hashInput.toString('hex'), 'hash32 result should be same as input');
        assert.equal(result.offset, 32, 'Offset is should be 32');
    
    });

    it(`deserializes hash96`, () => {

        let hashInput = hexToBytes('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015adba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015adba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
        let result = deserialize(serialize(hashInput, 'hash96'), 0, 'hash96');

        assert.isNotNull(result, 'hash96 result should not be null');
        assert.equal(result.deserializedData.toString('hex'), hashInput.toString('hex'), 'hash96 result should be same as input');
        assert.equal(result.offset, 96, 'Offset is should be 96');
    
    });
    
    it(`deserializes hash97`, () => {

        let hashInput = hexToBytes('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015adba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015adba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015adaa');
        let result = deserialize(serialize(hashInput, 'hash97'), 0, 'hash97');

        assert.isNotNull(result, 'hash97 result should not be null');
        assert.equal(result.deserializedData.toString('hex'), hashInput.toString('hex'), 'hash97 result should be same as input');
        assert.equal(result.offset, 97, 'Offset is should be 97');
    
    });
});

describe('SimpleSerialize - deserializes addresses', () => {

    it(`deserializes addresses`, () => {        
        
        let addressInput = hexToBytes('e17cb53f339a726e0b347bbad221ad7b50dc2a30');
        let result = deserialize(serialize(addressInput, 'address'), 0, 'address');

        assert.isNotNull(result, 'address result should not be null');
        assert.equal(result.deserializedData.toString('hex'), addressInput.toString('hex'), 'address result should be same as input');
        assert.equal(result.offset, 20, 'Offset is should be 20')

    });

});

describe('SimpleSerialize - deserializes signed integers', () => {

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

	it(`deserializes int24`, () => {

		let intInput = 8355840;
		let result = deserialize(serialize(intInput, 'int24'), 0, 'int24');

		assert.isNotNull(result, 'int24 result should not be null');
		assert.equal(result.deserializedData, intInput, 'int24 result should be same as input');
		assert.equal(result.offset, 3, 'Offset should be 2 bytes');

	});

    it(`deserializes int32`, () => {        
        
        let intInput = 1000000000;
        let result = deserialize(serialize(intInput, 'int32'), 0, 'int32');

        assert.isNotNull(result, 'int32 result should not be null');
        assert.equal(result.deserializedData, intInput, 'int32 result should be same as input');
        assert.equal(result.offset, 4, 'Offset should be 4 bytes');

    });

    it(`deserializes int64`, () => {        
        
        let intInput = new BN(100000000000);
        let result = deserialize(serialize(intInput, 'int64'), 0, 'int64');

        assert.isNotNull(result, 'int64 result should not be null');
        assert.isTrue(result.deserializedData.eq(intInput), `int64 result should be same as input actual: ${result.deserializedData} expected: ${intInput}`);
        assert.equal(result.offset, 8, 'Offset should be 8 bytes');

    });

    it(`deserializes int64 (negative)`, () => {        
        
        let intInput = new BN(-100000000000);
        let result = deserialize(serialize(intInput, 'int64'), 0, 'int64');

        assert.isNotNull(result, 'int64 result should not be null');
        assert.isTrue(result.deserializedData.eq(intInput), `int64 result should be same as input actual: ${result.deserializedData} expected: ${intInput}`);
        assert.equal(result.offset, 8, 'Offset should be 8 bytes');

    });

    it(`deserializes int256`, () => {        
        
        let intInput = new BN('123').pow(new BN(25));
        let result = deserialize(serialize(intInput, 'int256'), 0, 'int256');

        assert.isNotNull(result, 'int256 result should not be null');
        assert.isTrue(result.deserializedData.eq(intInput), `int256 result should be same as input actual: ${result.deserializedData} expected: ${intInput}`);
        assert.equal(result.offset, 32, 'Offset should be 32 bytes');

    });

    it(`deserializes int256 (negative)`, () => {        
        
        let intInput = new BN('-123').pow(new BN(25));
        let result = deserialize(serialize(intInput, 'int256'), 0, 'int256');

        assert.isNotNull(result, 'int256 result should not be null');
        assert.isTrue(result.deserializedData.eq(intInput), `int256 result should be same as input actual: ${result.deserializedData} expected: ${intInput}`);
        assert.equal(result.offset, 32, 'Offset should be 32 bytes');

    });

});

describe('SimpleSerialize - deserializes unsigned integers', () => {

    it(`deserializes uint8`, () => {        
        
        let intInput = 5;
        let result = deserialize(serialize(intInput, 'uint8'), 0, 'uint8');

        assert.isNotNull(result, 'uint8 result should not be null');
        assert.equal(result.deserializedData, intInput, 'uint8 result should be same as input');
        assert.equal(result.offset, 1, 'Offset should be 1 byte');

    });

    it(`deserializes uint16`, () => {        
        
        let intInput = 32000;
        let result = deserialize(serialize(intInput, 'uint16'), 0, 'uint16');

        assert.isNotNull(result, 'uint16 result should not be null');
        assert.equal(result.deserializedData, intInput, 'uint16 result should be same as input');
        assert.equal(result.offset, 2, 'Offset should be 2 bytes');

    });

	it(`deserializes uint24`, () => {

		let intInput = 8355840;
		let result = deserialize(serialize(intInput, 'uint24'), 0, 'uint24');

		assert.isNotNull(result, 'uint24 result should not be null');
		assert.equal(result.deserializedData, intInput, 'uint24 result should be same as input');
		assert.equal(result.offset, 3, 'Offset should be 4 bytes');

	});

    it(`deserializes uint32`, () => {        
        
        let intInput = 1000000000;
        let result = deserialize(serialize(intInput, 'uint32'), 0, 'uint32');

        assert.isNotNull(result, 'uint32 result should not be null');
        assert.equal(result.deserializedData, intInput, 'uint32 result should be same as input');
        assert.equal(result.offset, 4, 'Offset should be 4 bytes');

    });

    it(`deserializes uint64`, () => {        
        
        let intInput = new BN(100000000000);
        let result = deserialize(serialize(intInput, 'uint64'), 0, 'uint64');

        assert.isNotNull(result, 'uint64 result should not be null');

        assert.isTrue(result.deserializedData.eq(intInput), `uint64 result should be same as input actual: ${result.deserializedData} expected: ${intInput}`);
        assert.equal(result.offset, 8, 'Offset should be 8 bytes');

    });

    it(`deserializes uint128`, () => {        
        
        let intInput = new BN(1000000000);
        let result = deserialize(serialize(intInput, 'uint128'), 0, 'uint128');

        assert.isNotNull(result, 'uint128 result should not be null');

        assert.isTrue(result.deserializedData.eq(intInput), `uint128 result should be same as input actual: ${result.deserializedData} expected: ${intInput}`);
        assert.equal(result.offset, 16, 'Offset should be 16 bytes');

    });

    it(`deserializes uint256`, () => {        
        
        let intInput = new BN(100000000000000);
        let result = deserialize(serialize(intInput, 'uint256'), 0, 'uint256');

        assert.isNotNull(result, 'uint256 result should not be null');

        assert.isTrue(result.deserializedData.eq(intInput), `uint256 result should be same as input actual: ${result.deserializedData} expected: ${intInput}`);
        assert.equal(result.offset, 32, 'Offset should be 32 bytes');

    });

});

describe('SimpleSerialize - deserialize bytes', () => {

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

});

describe('SimpleSerialize - deserialize arrays', () => {

    it(`deserializes arrays of elements (of same type) - bool`, () => {
        let arrayInput = [true, false, true];
        let result = deserialize(serialize(arrayInput, ['bool']), 0, ['bool']);
        assert.deepEqual(result.deserializedData, arrayInput);
    });

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

    it(`deserializes arrays of elements (of the same type) - int64`, () => {
        scenarioDeserializeIntArrays(
            [new BN(-100000000000), new BN(100000000000), new BN(-100000000000)],
            'int64'
        );
    });

    it(`deserializes arrays of elements (of the same type) - int256`, () => {
        scenarioDeserializeIntArrays(
            [new BN(-1).pow(new BN(20)), new BN(1).pow(new BN(21)), new BN(-1).pow(new BN(22))],
            'int256'
        );
    });

    it(`deserializes arrays of elements (of the same type) - uint8`, () => {
        scenarioDeserializeIntArrays(
            [1, 2, 3],
            'uint8'
        );
    });

    it(`deserializes arrays of elements (of the same type) - uint16`, () => {
        scenarioDeserializeIntArrays(
            [32000, 32001, 32002],
            'uint16'
        );
    });

    it(`deserializes arrays of elements (of the same type) - uint32`, () => {
        scenarioDeserializeIntArrays(
            [1000000000, 1000000001, 1000000002],
            'uint32'
        );
    });

    it(`deserializes arrays of elements (of the same type) - uint64`, () => {
        scenarioDeserializeIntArrays(
            [new BN(100000000000), new BN(100000000000), new BN(100000000000)],
            'uint64'
        );
    });

    it(`deserializes arrays of elements (of the same type) - uint256`, () => {
        scenarioDeserializeIntArrays(
            [new BN(1).pow(new BN(20)), new BN(1).pow(new BN(21)), new BN(1).pow(new BN(22))],
            'uint256'
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
        for (let index = 0; index < result.deserializedData.length; index++) {
            const elementResult = result.deserializedData[index];
            const elementInput = arrayInput[index];
            if (typeof elementResult === 'object') {
                assert.isTrue(elementResult.eq(elementInput), `Serialised elements do not match input - actual ${elementResult} expected ${elementInput}`);
            }
            else{
                assert.equal(elementResult, elementInput, 'Serialised elements do not match input');
            }
        }
        assert.equal(result.offset, 4 + intByteLength(type) * arrayInput.length, `Offset should be length (4 bytes) + (${intByteLength(type)} * number of elements)`);
    }

});

describe('SimpleSerialize - deserialize objects', () => {

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
            'file': Buffer.from(bytesArray),
            'zz1': new BN(1000000000),
            'zz2': new BN(-5).pow(new BN(16)),
            'zz3': true
        };

        let fields = {
            'fields':{
                'publicAddress': 'address',
                'secret': 'hash32',
                'age': 'int8',
                'distance': 'int16',
                'halfLife': 'int32',
                'file': 'bytes',
                'zz1': 'uint64',
                'zz2': 'int256',
                'zz3': 'bool'
            }
        };

        let result = deserialize(serialize(valueObject, fields), 0, fields);

        // assert fields
        Object.keys(fields['fields'])
              .forEach(fieldName => {
                  let expectedValue = valueObject[fieldName];
                  let actualValue = result.deserializedData[fieldName];
                  if(typeof actualValue.eq === 'function'){
                    assert.isTrue(actualValue.eq(expectedValue), `Object serialised properties do not match input - actual ${actualValue} expected ${expectedValue}`);
                  }
                  else if(typeof actualValue.equals === 'function'){
                    assert.isTrue(actualValue.equals(expectedValue), `Object serialised properties do not match input - actual ${actualValue} expected ${expectedValue}`);   
                  }
                  else {
                    assert.equal(actualValue, expectedValue, 'Object serialised properties do not match input');
                  }
              });
    
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

});