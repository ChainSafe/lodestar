var exports = module.exports = {};

const assert = require('assert');

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
        return value
    }
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
