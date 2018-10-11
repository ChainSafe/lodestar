const assert = require('chai').assert;
const hexToBytes = require('./utils/hexToBytes').hexToBytes;
const readIntBytes = require('../src/intBytes').readIntBytes;
const intByteLength = require('../src/intBytes').intByteLength;
const ActiveState = require('./utils/activeState').ActiveState;
const AttestationRecord = require('./utils/activeState').AttestationRecord;
const serialize = require('../src/index').serialize;
const eq = require('../src/index').eq;
const deepcopy = require('../src/index').deepcopy;

describe("SimpleSerialize deepcopy", () => {
    
})
