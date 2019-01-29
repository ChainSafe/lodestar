const assert = require('chai').assert;
const BN = require('bn.js');
const hexToBytes = require('./utils/hexToBytes').hexToBytes;
const readIntBytes = require('../src/intBytes').readIntBytes;
const intByteLength = require('../src/intBytes').intByteLength;
const ActiveState = require('./utils/activeState').ActiveState;
const AttestationRecord = require('./utils/activeState').AttestationRecord;
const serialize = require('../src').serialize;
const testObjects = require('./utils/objects')

const SimpleObject = testObjects.SimpleObject
const OuterObject = testObjects.OuterObject
const InnerObject = testObjects.InnerObject
const ArrayObject = testObjects.ArrayObject

describe('SimpleSerialize - serializes booleans', () => {

    /** bool */

	it(`successfully serializes boolean true value`, () => {
        let boolInput = true;
        let result = serialize(boolInput, 'bool');

        assert.isNotNull(result, 'bool result should not be null');
        let intResult = result.readInt8(0);
        assert.isTrue(intResult == 1, boolInput, 'bool result should be same as input');

    });

    it(`successfully serializes boolean false value`, () => {
        let boolInput = false;
        let result = serialize(boolInput, 'bool');

        assert.isNotNull(result, 'bool result should not be null');
        let intResult = result.readInt8(0);
        assert.isTrue(intResult == 0, boolInput, 'bool result should be same as input');

    });

});

describe('SimpleSerialize - serializes bytes32', () => {

    /** bytes32 */

	it(`successfully serializes bytes32`, () => {

        let bytesInput = hexToBytes('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
        let result = serialize(bytesInput, 'bytes32');

        assert.isNotNull(result, 'bytes32 result should not be null');
        assert.equal(result, bytesInput, 'bytes32 result should be same as input');

    });

    it(`errors when serializing bytes32, given bytes less than 32 bytes`, () => {

        let bytesWithIncorrectLength = hexToBytes('ba7816bf8f01cfea414140de5dae2223');

        assert.throws(
            () => serialize(bytesWithIncorrectLength, 'bytes32'),
            Error,
            `given bytes32 ${bytesWithIncorrectLength} should be 32 bytes`
        );

    });

    it(`errors when serializing bytes32, given bytes greater than 32 bytes`, () => {

        let bytesWithIncorrectLength = hexToBytes('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015addfsdfds');

        assert.throws(
            () => serialize(bytesWithIncorrectLength, 'bytes32'),
            Error,
            `given bytes32 ${bytesWithIncorrectLength} should be 32 bytes`
        );

    });
});

describe('SimpleSerialize - serializes bytes96', () => {

    /** bytes32 */

	it(`successfully serializes bytes96`, () => {

        let bytesInput = hexToBytes('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015adba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015adba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
        let result = serialize(bytesInput, 'bytes96');

        assert.isNotNull(result, 'bytes96 result should not be null');
        assert.equal(result, bytesInput, 'bytes96 result should be same as input');

    });

    it(`errors when serializing bytes96, given bytes less than 96 bytes`, () => {

        let bytesWithIncorrectLength = hexToBytes('ba7816bf8f01cfea414140de5dae2223ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

        assert.throws(
            () => serialize(bytesWithIncorrectLength, 'bytes96'),
            Error,
            `given bytes96 ${bytesWithIncorrectLength} should be 96 bytes`
        );

    });

    it(`errors when serializing bytes96, given bytes greater than 96 bytes`, () => {

        let bytesWithIncorrectLength = hexToBytes('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015addfsdfds');

        assert.throws(
            () => serialize(bytesWithIncorrectLength, 'bytes96'),
            Error,
            `given bytes96 ${bytesWithIncorrectLength} should be 96 bytes`
        );

    });
});

describe('SimpleSerialize - serializes bytes97', () => {

    /** bytes32 */

	it(`successfully serializes bytes97`, () => {

        let bytesInput = hexToBytes('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015adba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015adba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015adqq');
        let result = serialize(bytesInput, 'bytes97');

        assert.isNotNull(result, 'bytes97 result should not be null');
        assert.equal(result, bytesInput, 'bytes97 result should be same as input');

    });

    it(`errors when serializing bytes97, given bytes less than 97 bytes`, () => {

        let bytesWithIncorrectLength = hexToBytes('ba7816bf8f01cfea414140de5dae2223ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

        assert.throws(
            () => serialize(bytesWithIncorrectLength, 'bytes97'),
            Error,
            `given bytes97 ${bytesWithIncorrectLength} should be 97 bytes`
        );

    });

    it(`errors when serializing bytes97, given bytes greater than 97 bytes`, () => {

        let bytesWithIncorrectLength = hexToBytes('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015addfsdfds');

        assert.throws(
            () => serialize(bytesWithIncorrectLength, 'bytes97'),
            Error,
            `given bytes97 ${bytesWithIncorrectLength} should be 97 bytes`
        );

    });
});

describe('SimpleSerialize - serializes bytes20', () => {

    /** bytes20 */

    it(`serializes bytes20`, () => {

        let bytes20Input = hexToBytes('e17cb53f339a726e0b347bbad221ad7b50dc2a30');
        let result = serialize(bytes20Input, 'bytes20');

        assert.isNotNull(result, 'bytes20 result should not be null');
        assert.equal(result, bytes20Input, 'bytes20 result should be same as input');

    });

    it(`errors when serializing bytes20, given bytes20 less than 20 bytes`, () => {

        let bytes20WithIncorrectLength = hexToBytes('e17cb53f339a726e0b34');

        assert.throws(
            () => serialize(bytes20WithIncorrectLength, 'bytes20'),
            Error,
            `given bytes20 ${bytes20WithIncorrectLength} should be 20 bytes`
        );

    });

    it(`errors when serializing bytes20, given bytes20 greater than 20 bytes`, () => {

        let bytes20WithIncorrectLength = hexToBytes('e17cb53f339a726e0b347bbad221ad7b50dc2a300000000');

        assert.throws(
            () => serialize(bytes20WithIncorrectLength, 'bytes20'),
            Error,
            `given bytes20 ${bytes20WithIncorrectLength} should be 20 bytes`
        );

    });
});

describe('SimpleSerialize - serializes signed integers', () => {

    it(`serializes int8`, () => {

        let intInput = 5;
        let result = serialize(intInput, 'int8');
        let intResult = result.readInt8(0);

        assert.isNotNull(result, 'int8 result should not be null');
        assert.equal(intResult, intInput, 'int8 result should be same as input');

    });

    it(`serializes int8 (negative)`, () => {

        let intInput = -5;
        let result = serialize(intInput, 'int8');
        let intResult = result.readInt8(0);

        assert.isNotNull(result, 'int8 result should not be null');
        assert.equal(intResult, intInput, 'int8 result should be same as input');

    });

    it(`serializes int16`, () => {

        let intInput = 32000;
        let result = serialize(intInput, 'int16');
        let intResult = result.readInt16LE(0);

        assert.isNotNull(result, 'int16 result should not be null');
        assert.equal(intResult, intInput, 'int16 result should be same as input');

    });

    it(`serializes int16 (negative)`, () => {

        let intInput = -32000;
        let result = serialize(intInput, 'int16');
        let intResult = result.readInt16LE(0);

        assert.isNotNull(result, 'int16 result should not be null');
        assert.equal(intResult, intInput, 'int16 result should be same as input');

    });

	it(`serializes int24`, () => {

		let intInput = 8355840;
		let result = serialize(intInput, 'int24');
		let intResult = result.readIntLE(0, 3);

		assert.isNotNull(result, 'int24 result should not be null');
		assert.equal(intResult, intInput, 'int24 result should be same as input');

	});

	it(`serializes int24 (negative)`, () => {

		let intInput = -8355840;
		let result = serialize(intInput, 'int24');
		let intResult = result.readIntLE(0, 3);

		assert.isNotNull(result, 'int24 result should not be null');
		assert.equal(intResult, intInput, 'int24 result should be same as input');

	});

    it(`serializes int32`, () => {

        let intInput = 1000000000;
        let result = serialize(intInput, 'int32');
        let intResult = result.readInt32LE(0);

        assert.isNotNull(result, 'int32 result should not be null');
        assert.equal(intResult, intInput, 'int32 result should be same as input');

    });

    it(`serializes int32 (negative)`, () => {

        let intInput = -1000000000;
        let result = serialize(intInput, 'int32');
        let intResult = result.readInt32LE(0);

        assert.isNotNull(result, 'int32 result should not be null');
        assert.equal(intResult, intInput, 'int32 result should be same as input');

    });

    it(`serializes int64`, () => {

        let intInput = new BN(100000000000);
        let result = serialize(intInput, 'int64');
        let intResult = new BN([...result], 16, 'le').fromTwos(64);

        assert.isNotNull(result, 'int64 result should not be null');
        assert.isTrue(intResult.eq(intInput), 'int64 result should be same as input');

    });

    it(`serializes int64 (negative)`, () => {

        let intInput = new BN(-100000000000);
        let result = serialize(intInput, 'int64');
        let intResult = new BN([...result], 16, 'le').fromTwos(64);

        assert.isNotNull(result, 'int64 result should not be null');
        assert.isTrue(intResult.eq(intInput), 'int64 result should be same as input');

    });

    it(`serializes int128`, () => {

        let intInput = new BN('123').pow(new BN(5));
        let result = serialize(intInput, 'int128');
        let intResult = new BN([...result], 32, 'le').fromTwos(256);

        assert.isNotNull(result, 'int128 result should not be null');
        assert.isTrue(intResult.eq(intInput), 'int128 result should be same as input');

    });

    it(`serializes int256 (negative)`, () => {

        let intInput = new BN('-123').pow(new BN(25));
        let result = serialize(intInput, 'int256');
        let intResult = new BN([...result], 32, 'le').fromTwos(256);

        assert.isNotNull(result, 'int256 result should not be null');
        assert.isTrue(intResult.eq(intInput), 'int256 result should be same as input');

    });


    it(`serializes int256`, () => {

        let intInput = new BN('123').pow(new BN(25));
        let result = serialize(intInput, 'int256');
        let intResult = new BN([...result], 32, 'le').fromTwos(256);

        assert.isNotNull(result, 'int256 result should not be null');
        assert.isTrue(intResult.eq(intInput), 'int256 result should be same as input');

    });

    it(`serializes int256 (negative)`, () => {

        let intInput = new BN('-123').pow(new BN(25));
        let result = serialize(intInput, 'int256');
        let intResult = new BN([...result], 32, 'le').fromTwos(256);

        assert.isNotNull(result, 'int256 result should not be null');
        assert.isTrue(intResult.eq(intInput), 'int256 result should be same as input');

    });

});

describe('SimpleSerialize - serializes unsigned integers', () => {

    it(`serializes uint8`, () => {

        let intInput = 5;
        let result = serialize(intInput, 'uint8');
        let intResult = result.readUInt8(0);

        assert.isNotNull(result, 'uint8 result should not be null');
        assert.equal(intResult, intInput, 'uint8 result should be same as input');

    });

    it(`serializes uint16`, () => {

        let intInput = 32000;
        let result = serialize(intInput, 'uint16');
        let intResult = result.readInt16LE(0);

        assert.isNotNull(result, 'uint16 result should not be null');
        assert.equal(intResult, intInput, 'uint16 result should be same as input');

    });

    it(`serializes uint32`, () => {

        let intInput = 1000000000;
        let result = serialize(intInput, 'uint32');
        let intResult = result.readInt32LE(0);

        assert.isNotNull(result, 'uint32 result should not be null');
        assert.equal(intResult, intInput, 'uint32 result should be same as input');

    });

    it(`serializes uint64`, () => {

        let intInput = new BN(100000000000);
        let result = serialize(intInput, 'uint64');
        let intResult = new BN([...result], 16, 'le');

        assert.isNotNull(result, 'uint64 result should not be null');
        assert.isTrue(intResult.eq(intInput), 'uint64 result should be same as input');

    });

    it(`serializes uint128`, () => {

        let intInput = new BN('123').pow(new BN(5));
        let result = serialize(intInput, 'uint128');
        let intResult = new BN([...result], 32, 'le').fromTwos(256);

        assert.isNotNull(result, 'uint128 result should not be null');
        assert.isTrue(intResult.eq(intInput), 'uint128 result should be same as input');

    });

    it(`serializes uint256`, () => {

        let intInput = new BN('123').pow(new BN(25));
        let result = serialize(intInput, 'uint256');
        let intResult = new BN([...result], 32, 'le').fromTwos(256);

        assert.isNotNull(result, 'uint256 result should not be null');
        assert.isTrue(intResult.eq(intInput), 'uint256 result should be same as input');

    });

});

describe('SimpleSerialize - serializes bytes', () => {

    it(`serializes bytes`, () => {

        let bytesArray = [];
        for(var i = 0; i < 280; i++){
            bytesArray.push(1);
        }
        let bytesInput = Buffer.from(bytesArray);
        let result = serialize(bytesInput, 'bytes');

        assert.isNotNull(result);
        assert.equal(result.readUInt32LE(0), bytesInput.byteLength)
        let bytesResult = result.slice(4);
        assert.deepEqual(bytesResult, bytesInput);

    });

});

describe('SimpleSerialize - serializes arrays of elements (of same type)', () => {

    it(`serializes arrays of elements (of same type) - boolean`, () => {
        let arrayInput = [true, false, false];

        let result = serialize(arrayInput, ['bool']);

        let actualLength = result.readUInt32LE(0);
        assert.equal(actualLength, arrayInput.length, 'Byte length should equal 3');
        let boolResult = result.slice(4);
        for (let index = 0; index < arrayInput.length; index++) {
            const input = arrayInput[index];
            assert.equal(boolResult.readUInt8(index), input ? 1 : 0, 'Booleans not serialized correctly');
        }
    });

    it(`serializes arrays of elements (of the same type) - bytes32`, () => {

        let arrayInput = [
            hexToBytes('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'),
            hexToBytes('dd7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015bb')
        ];
        let result = serialize(arrayInput, ['bytes32']);

        let flatInput = Buffer.from([...arrayInput[0], ...arrayInput[1]]);
        let expectedLength = flatInput.length; // (length + bytes)

        assert.isNotNull(result);

        assert.equal(result.readUInt32LE(0), expectedLength)

        let arrayResult = result.slice(4);
        assert.deepEqual(arrayResult, flatInput);

    });

    it(`serializes arrays of elements (of the same type) - bytes20`, () => {

        let arrayInput = [
            hexToBytes('e17cb53f339a726e0b347bbad221ad7b50dc2a30'),
            hexToBytes('ccccb53f339a726e0b347bbad221ad7b50daaaaa')
        ];
        let result = serialize(arrayInput, ['bytes20']);

        let flatInput = Buffer.from([...arrayInput[0], ...arrayInput[1]]);
        let expectedLength = flatInput.length; // (length + bytes)

        assert.isNotNull(result);

        assert.equal(result.readUInt32LE(0), expectedLength)

        let arrayResult = result.slice(4);
        assert.deepEqual(arrayResult, flatInput);

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

    it(`serializes arrays of elements (of the same type) - int64`, () => {

        scenarioTestArrayOfInts([new BN(100000000000), new BN(100000000001), new BN(100000000002)], 'int64');

    });

    it(`serializes arrays of elements (of the same type) - int256`, () => {

        scenarioTestArrayOfInts([new BN('1').pow(new BN(20)), new BN('1').pow(new BN(21)), new BN('1').pow(new BN(22))], 'int64');

    });

    it(`serializes arrays of elements (of the same type) - uint8`, () => {

        scenarioTestArrayOfInts([1, 2, 3], 'uint8');

    });

    it(`serializes arrays of elements (of the same type) - uint16`, () => {

        scenarioTestArrayOfInts([32000, 32001, 32002], 'uint16');

    });

    it(`serializes arrays of elements (of the same type) - uint32`, () => {

        scenarioTestArrayOfInts([1000000000, 1000000001, 1000000002], 'uint32');

    });

    it(`serializes arrays of elements (of the same type) - uint64`, () => {

        scenarioTestArrayOfInts([new BN(100000000000), new BN(100000000001), new BN(100000000002)], 'uint64');

    });

    it(`serializes arrays of elements (of the same type) - uint256`, () => {

        scenarioTestArrayOfInts([new BN('1').pow(new BN(20)), new BN('1').pow(new BN(21)), new BN('1').pow(new BN(22))], 'uint64');

    });

    it(`errors when serializing array, given more than one element type provided`, () =>{

        assert.throws(
            () => serialize([1,2], ['int32', 'int8']),
            Error,
            `array type should only have one element type`
        );

    });

    function scenarioTestArrayOfInts(arrayInput, type){
        let result = serialize(arrayInput, [type]);

        assert.isNotNull(result);
        let lengthResult = result.readUInt32LE(0);
        assert.equal(lengthResult, (arrayInput.length * intByteLength(type)));
        let resultView = result.slice(4);
        let inputIndex = 0;
        for(var i = 0; i < (result.byteLength-4); i+=intByteLength(type)) {
            let elementResult = readIntBytes(type)(resultView, i);
            let elementInput = arrayInput[inputIndex++];
            if (typeof elementResult === 'object') {
                assert.isTrue(elementResult.eq(elementInput), `Serialised elements do not match input - actual ${elementResult} expected ${elementInput}`);
            }
            else{
                assert.equal(elementResult, elementInput, 'Serialised elements do not match input');
            }

        }

    }

});


describe('SimpleSerialize - serializes objects', () => {

    it(`serialises objects of simple types`, () => {
        let bytes20Value = 'e17cb53f339a726e0b347bbad221ad7b50dc2a30';
        let bytes32Value = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
        let int8Value = 30;
        let int16Value = 32000;
        let int32Value = 1000000000;
        let uint64Value = new BN(1000000000);
        let int256Value = new BN(-5).pow(new BN(16));
        let boolValue = true;

        let bytesArray = [];
        for(var i = 0; i < 280; i++){
            bytesArray.push(8);
        }
        let bytesValue = Buffer.from(bytesArray);

        let result = serialize(
            {
                'publicAddress':hexToBytes(bytes20Value),
                'secret': hexToBytes(bytes32Value),
                'age': int8Value,
                'distance': int16Value,
                'halfLife': int32Value,
                'file': bytesValue,
                'zz1': uint64Value,
                'zz2': int256Value,
                'zz3': boolValue
            },
            {
                'fields': [
                    ['age', 'int8'],
                    ['distance', 'int16'],
                    ['file', 'bytes'],
                    ['halfLife', 'int32'],
                    ['publicAddress', 'bytes20'],
                    ['secret', 'bytes32'],
                    ['zz1', 'uint64'],
                    ['zz2', 'int256'],
                    ['zz3', 'bool'],
                ]
            }
        );

        let offset = 0;

        // assert byte length
        let expectedByteLength = 384;
        let actualByteLength = result.readInt32LE(offset);
        offset += 4;
        assert.equal(actualByteLength, expectedByteLength, 'Byte length is not correct');

        // assert int8 value
        let actualInt8 = result.readUInt8(offset);
        offset += 1;
        assert.equal(actualInt8, int8Value, 'Int8 value not serialised correctly');

        // assert int16 value
        let actualInt16 = result.readUInt16LE(offset);
        offset += 2;
        assert.equal(actualInt16, int16Value, 'Int16 value not serialised correctly');

        // assert bytes value
        let actualBytesLength = result.readUInt32LE(offset);
        assert.equal(actualBytesLength, 280);
        offset += 4;
        let actualBytes = result.slice(offset, (offset + 280));
        offset += 280;
        assert.equal(actualBytes.toString('hex'), bytesValue.toString('hex'), 'Bytes type not serialised correctly');

        // assert int32 value
        let actualInt32 = result.readUInt32LE(offset);
        offset += 4;
        assert.equal(actualInt32, int32Value, 'Int32 value not serialised correctly');

        // assert bytes20 value
        let actualBytes20 = result.slice(offset, (offset + 20));
        offset += 20;
        assert.equal(actualBytes20.toString('hex'), bytes20Value, 'Bytes20 type not serialised correctly');

        // assert bytes32 value
        let actualBytes32 = result.slice(offset, (offset + 32));
        offset += 32;
        assert.equal(actualBytes32.toString('hex'), bytes32Value, 'Bytes32 type not serialised correctly');

        // assert uint64 value
        let actualUint64 = new BN([...result.slice(offset, (offset + 8))], 16, 'le');
        offset += 8;
        assert.isTrue(actualUint64.eq(uint64Value), `Serialised object values are not correct actual ${actualUint64} expected ${uint64Value}`);

        // assert int256 value
        let actualInt256 = new BN([...result.slice(offset, (offset + 32))], 16, 'le');
        offset += 32;
        assert.isTrue(actualInt256.eq(int256Value), `Serialised object values are not correct actual ${actualInt256} expected ${int256Value}`);

        // assert bool value
        let actualBool = result.readUInt8(offset);
        offset += 1;
        assert.equal(actualBool === 1 ? true : false, boolValue, 'Bool value not serialised correctly');

    });

    it(`serializes objects containing objects`, () => {
        let testObj = new ActiveState();
        let recentBytes1 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
        let recentBytes2 = 'aa1116bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
        testObj.recentBlockHashes = [
            hexToBytes(recentBytes1),
            hexToBytes(recentBytes2)
        ]

        let attestRecord1 = new AttestationRecord(0, 1, Buffer.from([11, 12, 13, 14]));
        let attestRecord2 = new AttestationRecord(2, 3, Buffer.from([255, 254, 253, 252]));
        testObj.pendingAttestations = [
            attestRecord1,
            attestRecord2
        ]

        let result = serialize(testObj, ActiveState);

        let offset = 0;

        // assert byte length
        let expectedByteLength = 112;
        let actualByteLength = result.readInt32LE(offset);
        offset += 4;
        assert.equal(actualByteLength, expectedByteLength, 'Byte length is not correct');

        // assert pending attestations array
        // skip attestation record array byte length because it could vary
        offset += 4;
        offset = assertAttestationRecord(offset, result, attestRecord1);
        offset = assertAttestationRecord(offset, result, attestRecord2);

        // assert bytes32 array
        let expectedBytesArrayLength = testObj.recentBlockHashes.length * 32; // 32 byte bytes
        let actualBytesArrayLength = result.readInt32LE(offset);
        offset += 4;
        assert.equal(actualBytesArrayLength, expectedBytesArrayLength, 'Bytes32 array length is not correct');
        let actualBytes1 = result.slice(offset, (offset + 32));
        offset += 32;
        assert.equal(actualBytes1.toString('hex'), recentBytes1, 'Bytes32 1 not serialised correctly');
        let actualBytes2 = result.slice(offset, (offset + 32));
        offset += 32;
        assert.equal(actualBytes2.toString('hex'), recentBytes2, 'Bytes32 2 not serialised correctly');
    });

    function assertAttestationRecord(startOffset, result, attestRecord){
        let offset = startOffset;
        // skip attestation record byte length because it could vary
        offset += 4;

        // assert bitfield value
        let expectedBitfieldByteLength = 4;
        let actualBitfieldByteLength = result.readUInt32LE(offset);
        assert.equal(actualBitfieldByteLength, expectedBitfieldByteLength, 'Attester bitfield array not serialised correctly');
        offset += 4;
        let actualBitfield = result.slice(offset, (offset + expectedBitfieldByteLength));
        offset += expectedBitfieldByteLength;
        assert.equal(actualBitfield.toString('hex'), attestRecord.attesterBitfield.toString('hex'), 'Attester Bitfield type not serialised correctly');

        // check shard id
        let actualShardId = result.readUInt32LE(offset);
        offset += 4;
        assert.equal(actualShardId, attestRecord.shardId, 'ShardId value not serialised correctly');

        // check slot id
        let actualSlotId = result.readUInt32LE(offset);
        offset += 4;
        assert.equal(actualSlotId, attestRecord.slotId, 'SlotId value not serialised correctly');

        return offset;
    }
    const testCases = [
      [[{b:0,a:0}, SimpleObject], "03000000000000"],
      [[{b:2,a:1}, SimpleObject], "03000000020001"],
      [[{v:3, subV:{v:6}}, OuterObject], "0700000003020000000600"],
      [[{v: [{b:2,a:1}, {b:4,a:3}]}, ArrayObject], "120000000e0000000300000002000103000000040003"],
      [[[{v:3, subV:{v:6}}, {v:5, subV:{v:7}}], [OuterObject]], "1600000007000000030200000006000700000005020000000700"],
    ];

    for (const [input, output] of testCases) {
      const [value, type] = input;
      it(`serializes objects - ${type.name || typeof type}`, () => {
        assert.equal(serialize(value, type).toString('hex'), output)
      })
    }
});
