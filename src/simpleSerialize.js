var exports = module.exports = {};

/**
 * Simply Serializes
 * hash32 - expects input as bytes of hash
 * address - expects input as bytes of address
 */

 // TODO - hash32 and address expects bytes - bit inconvenient

function serialize(value, type) {

    // serialize hashes
    if(type === 'hash32') {
        
        // check length is 32 bytes
        if(value.byteLength !== 32) {
            throw Error(`given hash32 ${value} should be 32 bytes`);
        }
        return value;

    }

    // serialize (Ethereum) addresses
    if(type === 'address') {

        // check length is 20 bytes
        if(value.length !== 20) {
            throw Error(`given address ${value} should be 20 bytes`);
        }
        return value;

    }

    // serialize integers
    if((typeof type === 'string') && type.startsWith('int')) {

        let intSize = parseInt(type.substr(3));
        if(intSize > 0 && intSize <= 64 && intSize % 8 !== 0) {
            throw Error(`given int type has invalid size (8, 16, 32, 64)`);
        }

        // convert to int
        let intValue = parseInt(value);

        // check max size is within bounds of type
        let maxSize = 32 * intSize;
        if(intValue >= maxSize){
            throw Error(`given value is too large for type size ${type}`);
        }

        // return bytes
        let view = new DataView(new ArrayBuffer(intSize / 8));
        switch(intSize) {
            case 8:
                view.setUint8(0, intValue, false); // bigendian
                return view.buffer;
            case 16:
                view.setUint16(0, intValue, false); // bigendian
                return view.buffer;
            case 32:
                view.setUint32(0, intValue, false); // bigendian
                return view.buffer;
            case 64:
                view.setUint64(0, intValue, false); // bigendian
                return view.buffer;
            default:
                throw Error("Unmatched..")
        }  
    }

    // cannot serialize
    return null;
}

exports.serialize = serialize