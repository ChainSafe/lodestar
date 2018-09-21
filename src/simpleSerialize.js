var exports = module.exports = {};

/**
 * Simply Serializes
 * hash32 - expects input as bytes of hash
 * address - expects input as bytes of address
 */

 // TODO - hash32 and address expects bytes - bit inconvenient
const intToBytes = {
     8: (view, value) => { view.setUint8(0, value, false) },
     16: (view, value) => { view.setUint16(0, value, false) },
     32: (view, value) => { view.setUint32(0, value, false) }
}


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
        let view = new DataView(new ArrayBuffer(intSize / 8));
        intToBytes[intSize](view, intValue);
        return view.buffer;
        
    }

    // serialize bytes
    if(type === 'bytes') {
        // return (length + bytes)
        let buffer = new ArrayBuffer(4 + value.byteLength);
        let view = new DataView(buffer);
        // write length to buffer as 4 byte int
        view.setUint32(0, value.byteLength, false); // bigendian
        // write bytes to buffer
        let tmp = new Uint8Array(buffer);
        tmp.set(new Uint8Array(value), 4); // length offset
        return buffer;
    }

    // serialize array of a specified type
    if (Array.isArray(value) && Array.isArray(type)) {
        
        // only 1 element type is allowed
        if(type.length > 1){
            throw Error('array type should only have one element type');
        }

        // serialize each element of the array
        let serializedValues = value.map((element) => serialize(element, type[0]));
        let totalByteLength = serializedValues.reduce((acc, v) => acc + v.byteLength, 0);

        // return (length + bytes of array element)
        let buffer = new ArrayBuffer(4 + totalByteLength);
        let view = new DataView(buffer);

        // write length to buffer as 4 byte int
        view.setUint32(0, totalByteLength, false); // bigendian
        let tmp = new Uint8Array(buffer);

        // start from end of the length number (4 bytes)
        let offset = 4;
        for (let i = 0; i < serializedValues.length; i++) {
            let serializedValue = serializedValues[i];
            tmp.set(new Uint8Array(serializedValue), offset); 
            offset += serializedValue.byteLength;   
        }
        return buffer;

    }

    // cannot serialize
    return null;
}

exports.serialize = serialize