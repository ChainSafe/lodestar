var exports = module.exports = {};

const assert = require('assert');

function _toBytes(n, length, endianess) {
    var buffer = new ArrayBuffer(length);
    var dataView = new DataView(buffer);
    if(endianess === 'big') {
        dataView.setInt32(0, n, true);
    } else {
        dataView.setInt32(0, n, false);
    }

    var byteArray = Array.from(buffer);
    return byteArray;

}

function serialize(value, type) {
    if (type === null && val.hasOwnProperty('fields')) {
        type = typeof(value);
    }

    if (['hash32', 'address'].includes(type)) {
        if(type === 'address') {
            assert(value.length === 20);
        } else {
            assert(value.length === 32);
        }
        return value;
    }
    else if (type instanceof String && type[:3] === 'int') {
        length = Number(type[:3]);
        assert(length % 8 === 0);
        return _toBytes(value, Math.floor(length / 8), 'big');
    }
    else if (type === 'bytes') {
        return _toBytes(value.length, 4, 'big') + type;
    }
    else if (type instanceof Array) {
        assert(type.length === 1);
        for(x in value) {
            sub = [serialize(x, type[0])].join('');
            return _toBytes(sub.length, 4, 'big') + sub
        }
    }

    throw new Error('Cannot serialize: value -> ' + value + ' type -> ' + type);
}

function _deserialize(data, start, type) {

}

function deserialize(data, type) {
    return _deserialize(data, 0, type)[0]
}

function eq(x,y) {

}

function deepcopy(x) {

}

function toObj(x) {

}

exports.serialize = serialize;
exports.deserialize = deserialize;
exports.eq = eq;
exports.deepcopy = deepcopy;
exports.toObj = toObj;
