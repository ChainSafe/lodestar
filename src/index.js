const intByteLength = require('./intBytes').intByteLength;
const readIntBytes = require('./intBytes').readIntBytes;
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
    if((typeof type === 'string') && !!type.match(/^u?int\d+$/g)) {

        // determine int size
        let intSize = parseInt(type.match(/\d+/g));
        if(intSize > 0 && intSize <= 256 && intSize % 8 !== 0) {
            throw Error(`given int type has invalid size (8, 16, 32, 64, 256)`);
        }

        // return bytes
        let buffer = Buffer.alloc(intSize / 8)
        writeIntBytes(type)(buffer, value);
        return buffer;

    }

    // serialize bytes
    if(type === 'bytes') {
        // return (length + bytes)
        let byteLengthBuffer = Buffer.alloc(4);
        // write length to buffer as 4 byte int
        byteLengthBuffer.writeUInt32BE(value.byteLength); // bigendian
        // write bytes to buffer
        return Buffer.concat([byteLengthBuffer, value]);
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

    // serializes objects (including compound objects)
    if ((typeof type == 'object'|| typeof type == 'function') && type.hasOwnProperty('fields')) {
        let buffers = [];
        Object.keys(type.fields)
            .sort()
            .forEach(fieldName => {
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
 * Simply Deserializes (SSZ)
 * @method deserialize
 * @param {Buffer} data bytes (buffer) to deserialize
 * @param {string|object} type - A type string ('hash32', 'address', 'int8', 'int16', 'int32', 'bytes'), or type array ['hash32'], or type object containing fields property
 * @return {Buffer|array|number|object} deserialized value : hash32 (Buffer) | address (Buffer) | int8/16/32/64/256 | uint8/16/32/64/256 | bytes (Buffer) | array | object
 */
function deserialize(data, start, type) {
    const int32ByteLength = intByteLength('int32');

    // deserializes hashes
    if(type === 'hash32') {
        const hashLength = 32;
        // TODO: assert len(data) + start >= length
        return {
            deserializedData: data.slice(start, (start + hashLength)),
            offset: start + hashLength
        }
    }

    // deserializes addresses
    if(type === 'address') {
        const addressLength = 20;
        // TODO: assert len(data) + start >= length
        return {
            deserializedData: data.slice(start, (start + addressLength)),
            offset: start + addressLength
        }
    }

    // deserializes unsigned integers
    if((typeof type === 'string') && !!type.match(/^u?int\d+$/g)) {

        // determine int size
        let intSize = parseInt(type.match(/\d+/g));
        if(intSize > 0 && intSize <= 32 && intSize % 8 !== 0) {
            throw Error(`given int type has invalid size (8, 16, 32)`);
        }

        // TODO: assert len(data) + start >= length
        
        return {
            deserializedData: readIntBytes(type)(data, start),
            offset: start + intByteLength(type)
        }
    }

    // deserialize bytes
    if(type === 'bytes') {

        // TODO: assert len(data) + start >= 4+length
        let length = readIntBytes('int32')(data, start);
        return {
            deserializedData: data.slice(start + int32ByteLength, (start + length + int32ByteLength)),
            offset: start + int32ByteLength + length
        }
    }

    // deserializes array of a specified type
    if (Array.isArray(type)) {
        
        // only 1 element type is allowed
        if(type.length > 1){
            throw Error('array type should only have one element type');
        }

        // deserialize each element of the array
        let elementType = type[0];

        let length = readIntBytes('int32')(data, start);
        let output = [];
        let position = start + int32ByteLength;
        
        // work through the data deserializing the array elements
        while(position < (start + int32ByteLength + length)) {
            let response = deserialize(data, position, elementType);
            position = response.offset;
            output.push(response.deserializedData);
        }

        // check that we have have arrived at the end of the byte stream
        if(position !== (start + int32ByteLength + length)) {
            throw Error('We did not arrive at the end of the byte length');
        }

        return {
            deserializedData: output,
            offset: position
        };
    }

    // deserializes objects (including compound objects)
    if ((typeof type == 'object'|| typeof type == 'function') && type.hasOwnProperty('fields')) {

        let length = readIntBytes('int32')(data, start);
        let output = {};
        let position = start + int32ByteLength;

        Object.keys(type.fields)
            .sort()
            .forEach(fieldName => {
                let fieldResult = deserialize(data, position, type.fields[fieldName]);
                position = fieldResult.offset;
                output[fieldName] = fieldResult.deserializedData;
            });

        return {
            deserializedData: output,
            offset: position
        };
    }

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


exports.serialize = serialize;
exports.deserialize = deserialize;
exports.eq = eq
exports.deepcopy = deepcopy
exports.toObject = toObject