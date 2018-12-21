const assert = require('chai').assert;
const hexToBytes = require('./utils/hexToBytes').hexToBytes;
const readIntBytes = require('../src/intBytes').readIntBytes;
const intByteLength = require('../src/intBytes').intByteLength;
const ActiveState = require('./utils/activeState').ActiveState;
const AttestationRecord = require('./utils/activeState').AttestationRecord;
const serialize = require('../src/index').serialize;
const eq = require('../src/index').eq;

describe('SimpleSerialize eq', () => {

    it('should be reflexive with hash32 object that was simply serialized', () => {
        let hashInput = hexToBytes('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
        let result = serialize(hashInput, 'hash32');

        assert(eq(result,result) === true, "hash32 result should be the same as itself");
    })

    it('should be false given different hash32 objects that were simply serialized', () => {
        let hashInput1 = hexToBytes('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
        let result1 = serialize(hashInput1, 'hash32');

        let hashInput2 = hexToBytes('bb7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
        let result2 = serialize(hashInput2, 'hash32');

        assert(eq(result1,result2) === false, "both hash32 objects should be different");
    })

    it('should be reflexive with address object that was simply serialized', () => {
        let addressInput = hexToBytes('e17cb53f339a726e0b347bbad221ad7b50dc2a30');
        let result = serialize(addressInput, 'address');

        assert(eq(result,result) === true, "address result should be the same as itself");
    })

    it('should be false given different hash32 objects that were simply serialized', () => {
        let addressInput1 = hexToBytes('e17cb53f339a726e0b347bbad221ad7b50dc2a30');
        let result1 = serialize(addressInput1, 'address');

        let addressInput2 = hexToBytes('e17db53f339a726e0b347bbad221ad7b50dc2a30');
        let result2 = serialize(addressInput2, 'address');

        assert(eq(result1,result2) === false, "both address objects should be different");
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
