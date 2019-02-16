const assert = require('chai').assert;
const hexToBytes = require('./utils/hexToBytes').hexToBytes;
const intByteLength = require('../src/intBytes').intByteLength;
const ActiveState = require('./utils/activeState').ActiveState;
const AttestationRecord = require('./utils/activeState').AttestationRecord;
const serialize = require('../src/index').serialize;
const eq = require('../src/index').eq;

describe('SimpleSerialize eq', () => {

    it('should be reflexive with bytes32 object that was simply serialized', () => {
        let bytesInput = hexToBytes('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
        let result = serialize(bytesInput, 'bytes32');

        assert(eq(result,result) === true, "bytes32 result should be the same as itself");
    })

    it('should be false given different bytes32 objects that were simply serialized', () => {
        let bytesInput1 = hexToBytes('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
        let result1 = serialize(bytesInput1, 'bytes32');

        let bytesInput2 = hexToBytes('bb7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
        let result2 = serialize(bytesInput2, 'bytes32');

        assert(eq(result1,result2) === false, "both bytes32 objects should be different");
    })

    it('should be reflexive with bytes20 object that was simply serialized', () => {
        let bytes20Input = hexToBytes('e17cb53f339a726e0b347bbad221ad7b50dc2a30');
        let result = serialize(bytes20Input, 'bytes20');

        assert(eq(result,result) === true, "bytes20 result should be the same as itself");
    })

    it('should be false given different bytes32 objects that were simply serialized', () => {
        let bytes20Input1 = hexToBytes('e17cb53f339a726e0b347bbad221ad7b50dc2a30');
        let result1 = serialize(bytes20Input1, 'bytes20');

        let bytes20Input2 = hexToBytes('e17db53f339a726e0b347bbad221ad7b50dc2a30');
        let result2 = serialize(bytes20Input2, 'bytes20');

        assert(eq(result1,result2) === false, "both bytes20 objects should be different");
    })

    it('should be reflexive with int8 object that was simply serialized', () => {
        let intInput = 5;
        let result = serialize(intInput, 'int8');

        assert(eq(result, result) === true, "int8 result should be the same as itself");
    })

    it('should be false given different int8 objects that were simply serialized', () => {
        let intInput1 = 5;
        let result1 = serialize(intInput1, 'int8');

        let intInput2 = 10;
        let result2 = serialize(intInput2, 'int8');

        assert(eq(result1,result2) === false, "both int8 objects should be different");
    })

    it('should be reflexive with int16 object that was simply serialized', () => {
        let intInput = 32000;
        let result = serialize(intInput, 'int16');

        assert(eq(result, result) === true, "int16 result should be the same as itself");
    })

    it('should be false given different int16 objects that were simply serialized', () => {
        let intInput1 = 32000;
        let result1 = serialize(intInput1, 'int16');

        let intInput2 = 32001;
        let result2 = serialize(intInput2, 'int16');

        assert(eq(result1,result2) === false, "both int16 objects should be different");
    })

	it('should be reflexive with int24 object that was simply serialized', () => {
		let intInput = 8355840;
		let result = serialize(intInput, 'int24');

		assert(eq(result, result) === true === true, "int24 result should be the same as itself");
	})

	it('should be false given different int24 objects that were simply serialized', () => {
		let intInput1 = 8355840;
		let result1 = serialize(intInput1, 'int24');

		let intInput2 = 16777213;
		let result2 = serialize(intInput2, 'int24');

		assert(eq(result1,result2) === false, "both int24 objects should be different");
	})

    it('should be reflexive with int32 object that was simply serialized', () => {
        let intInput = 1000000000;
        let result = serialize(intInput, 'int32');

        assert(eq(result, result) === true === true, "int32 result should be the same as itself");
    })

    it('should be false given different int32 objects that were simply serialized', () => {
        let intInput1 = 1000000000;
        let result1 = serialize(intInput1, 'int32');

        let intInput2 = 2147483645;
        let result2 = serialize(intInput2, 'int32');

        assert(eq(result1,result2) === false, "both int32 objects should be different");
    })

    it('should be reflexive with bytes object that was simply serialized', () => {
        let bytesArray = [];
        for(var i = 0; i < 280; i++){
            bytesArray.push(1);
        }
        let bytesInput = Buffer.from(bytesArray);
        let result = serialize(bytesInput, 'bytes');


        assert(eq(result, result) === true === true, "int32 result should be the same as itself");
    })

    it('should be false given different bytes objects that were simply serialized', () => {
        let bytesArray1 = [];
        for(var i = 0; i < 280; i++){
            bytesArray1.push(1);
        }
        let bytesInput1 = Buffer.from(bytesArray1);
        let result1 = serialize(bytesInput1, 'bytes');

        let bytesArray2 = [];
        for(var i = 0; i < 280; i++){
            bytesArray2.push(2);
        }
        let bytesInput2 = Buffer.from(bytesArray2);
        let result2 = serialize(bytesInput2, 'bytes');

        assert(eq(result1,result2) === false, "both bytes objects should be different");
    })


})
