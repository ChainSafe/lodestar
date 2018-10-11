const writeIntBytes = require('./intBytes').writeIntBytes;
const deepCopy = require('deepcopy');

/**
 * Simply Serializes (SSZ)
 * @method serialize
 * @param {Buffer|array|number|object} value - Value to serialize: hash32 (Buffer) | address (Buffer) | int8/16/32 | bytes (Buffer) | array | object
 * @param {string|object} type - A type string ('hash32', 'address', 'int8', 'int16', 'int32', 'bytes'), or type array ['hash32'], or type object containing fields property
 * @return {Buffer} the byte output
 */
function serialize(value, type) {

    // serialize hashes
    if(type === 'hash32') {

        // check length is 32 byte
        if(value.byteLength !== 32) {
            throw Error(`given hash32 ${value} should be 32 bytes`);
        }
        return value;

    }

    // serialize (Ethereum) addresses
    if(type === 'address') {

        // check length is 20 byte
        if(value.byteLength !== 20) {
            throw Error(`given address ${value} should be 20 bytes`);
        }
        return value;

    }

    // serialize integers
    if((typeof type === 'string') && type.startsWith('int')) {

        // determine int size
        let intSize = parseInt(type.substr(3));
        if(intSize > 0 && intSize <= 32 && intSize % 8 !== 0) {
            throw Error(`given int type has invalid size (8, 16, 32)`);
        }

        // convert to value to int
        let intValue = parseInt(value);

        // check max size is within bounds of type
        let maxSize = Math.pow(2, intSize) / 2;
        if(intValue >= maxSize){
            throw Error(`given value is too large for type size ${type}`);
        }

        // return bytes
        // let view = new DataView(new ArrayBuffer(intSize / 8));
        let buffer = Buffer.alloc(intSize / 8)
        writeIntBytes(type)(buffer, intValue);
        return buffer;

    }

    // serialize bytes
    if(type === 'bytes') {
        // return (length + bytes)
        let buffer = Buffer.alloc(4);
        // write length to buffer as 4 byte int
        buffer.writeUInt32BE(value.byteLength); // bigendian
        // write bytes to buffer
        return Buffer.concat([buffer, value]);
    }

    // serialize array of a specified type
    if (Array.isArray(value) && Array.isArray(type)) {

        // only 1 element type is allowed
        if(type.length > 1){
            throw Error('array type should only have one element type');
        }

        // serialize each element of the array
        let elementType = type[0];
        let serializedValues = value.map((element) => serialize(element, elementType));
        let totalByteLength = serializedValues.reduce((acc, v) => acc + v.byteLength, 0);

        // write length to buffer as 4 byte int
        let byteLengthBuffer = Buffer.alloc(4);
        byteLengthBuffer.writeUInt32BE(totalByteLength); // bigendian

        // start from end of the length number (4 bytes)
        let ass = serializedValues.map((ab) => Buffer.from(ab));
        return Buffer.concat([byteLengthBuffer, ...ass], totalByteLength + 4);

    }

    if ((typeof type == 'object'|| typeof type == 'function') && type.hasOwnProperty('fields')) {
        let buffers = [];
        Object.keys(type.fields).forEach(fieldName => {
            buffers.push(serialize(value[fieldName], type.fields[fieldName]));
        });

        let totalByteLength = buffers.reduce((acc, v) => acc + v.byteLength, 0);
        let byteLengthBuffer = Buffer.alloc(4);
        byteLengthBuffer.writeUInt32BE(totalByteLength); // bigendian

        return Buffer.concat([byteLengthBuffer, ...buffers]);
    }

    // cannot serialize
    return null;
}

/**
 * Checks if 2 simply serialized objects are equal (SSZ)
 * @method eq
 * @param {Buffer} x - simply serialized object
 * @param {Buffer} y - simply serialized object
 * @return {Bool} the byte output
 */
function eq(x, y) {
    // Since we serialized x and y as buffers and buffers in JS are deterministic, we can do the following
    return x.equals(y);

}

/**
 * Returns a deep copy of a simply serialized object (SSZ)
 * @method deepcopy
 * @param {Buffer} x - Value to deep copy
 * @return {Buffer} the deep copy of x
 */
function deepcopy(x) {
    return deepCopy(x);
    
}

/**
 * Converts a simply serialized object to a simple Javascript object (SSZ)
 * @method toObject
 * @param {Buffer} x - Value to convert to a Js object
 * @return {Buffer} object
 */
function toObject(x) {

}

exports.serialize = serialize
exports.eq = eq
exports.deepcopy = deepcopy
exports.toObject = toObject
