
function intByteLength(type) {
    return {'int8':1, 'int16': 2, 'int32': 4, 'hash32': 1, 'address': 1}[type];
}
                
function newIntArray(result, type, offset) {
    switch(type){
        case 'hash32':
            return new Uint8Array(result, offset);
        case 'address':
            return new Uint8Array(result, offset);
        case 'int8':
            return new Uint8Array(result, offset);
        case 'int16':
            return new Uint16Array(result, offset);
        case 'int32':
            return new Uint32Array(result, offset);
    }
};

exports.intByteLength = intByteLength;
exports.newIntArray = newIntArray;