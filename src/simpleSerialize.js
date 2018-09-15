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
        if(value.length !== 32) {
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

    // cannot serialize
    return null;
}

exports.serialize = serialize