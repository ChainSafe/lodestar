const writeIntBytes = require('./intBytes').writeIntBytes;

/**
 * Simply Serializes
 * hash32 - expects input as bytes of hash
 * address - expects input as bytes of address
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
        let totalByteLength = 4 + serializedValues.reduce((acc, v) => acc + v.byteLength, 0);

        // write length to buffer as 4 byte int
        let buffer = Buffer.alloc(4);
        buffer.writeUInt32BE(totalByteLength); // bigendian

        // start from end of the length number (4 bytes)
        let ass = serializedValues.map((ab) => Buffer.from(ab));
        return Buffer.concat([buffer, ...ass], totalByteLength);

    }

    if (typeof type == 'object' && type.hasOwnProperty('fields')) {
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

exports.serialize = serialize