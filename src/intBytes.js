const BN = require('bn.js');

function intByteLength(type) {
    return {
        'int8':1,
        'uint8': 1, 
        'int16': 2,
        'uint16': 2, 
        'int32': 4,
        'uint32': 4,
        'int64': 8,
        'uint64': 8,
        'int256': 32,
        'uint256': 32
    }[type];
}

function readIntBytes(type) {
    return {
        'int8': (buffer, offset) => buffer.readInt8(offset),
        'uint8': (buffer, offset) => buffer.readUInt8(offset),
        'int16': (buffer, offset) => buffer.readInt16BE(offset),
        'uint16': (buffer, offset) => buffer.readUInt16BE(offset),
        'int32': (buffer, offset) => buffer.readInt32BE(offset),
        'uint32': (buffer, offset) => buffer.readUInt32BE(offset),
        'int64': (buffer, offset) => new BN([...buffer.slice(offset, (offset + 8))], 16, 'be').fromTwos(64),
        'uint64': (buffer, offset) => new BN([...buffer.slice(offset, (offset + 8))], 16, 'be'),
        'int256': (buffer, offset) => new BN([...buffer.slice(offset, (offset + 32))], 16, 'be').fromTwos(256),
        'uint256': (buffer, offset) => new BN([...buffer.slice(offset, (offset + 32))], 16, 'be')
    }[type];
}

function writeIntBytes(type) {
    return {
        'int8': (buffer, value) => { buffer.writeInt8(value) },
        'uint8': (buffer, value) => { buffer.writeUInt8(value) },
        'int16': (buffer, value) => { buffer.writeInt16BE(value) },
        'uint16': (buffer, value) => { buffer.writeUInt16BE(value) },
        'int32': (buffer, value) => { buffer.writeInt32BE(value) },
        'uint32': (buffer, value) => { buffer.writeUInt32BE(value) },
        'int64': (buffer, value) => { value.toTwos(64).toBuffer('be', 8).copy(buffer); },
        'uint64': (buffer, value) => { value.toBuffer('be', 8).copy(buffer); },
        'int256': (buffer, value) => { value.toTwos(256).toBuffer('be', 32).copy(buffer); },
        'uint256': (buffer, value) => { value.toBuffer('be', 32).copy(buffer); }
    }[type];
}

exports.intByteLength = intByteLength;
exports.readIntBytes = readIntBytes;
exports.writeIntBytes = writeIntBytes;