function intByteLength(type) {
    return {
        'int8':1,
        'uint8': 1, 
        'int16': 2,
        'uint16': 2, 
        'int32': 4,
        'uint32': 4
    }[type];
}

function readIntBytes(type) {
    return {
        'int8': (buffer, value) => buffer.readInt8(value),
        'uint8': (buffer, value) => buffer.readUInt8(value),
        'int16': (buffer, value) => buffer.readInt16BE(value),
        'uint16': (buffer, value) => buffer.readUInt16BE(value),
        'int32': (buffer, value) => buffer.readInt32BE(value),
        'uint32': (buffer, value) => buffer.readUInt32BE(value)
    }[type];
}

function writeIntBytes(type) {
    return {
        'int8': (buffer, value) => { buffer.writeInt8(value) },
        'uint8': (buffer, value) => { buffer.writeUInt8(value) },
        'int16': (buffer, value) => { buffer.writeInt16BE(value) },
        'uint16': (buffer, value) => { buffer.writeUInt16BE(value) },
        'int32': (buffer, value) => { buffer.writeInt32BE(value) },
        'uint32': (buffer, value) => { buffer.writeUInt32BE(value) }
    }[type];
}

exports.intByteLength = intByteLength;
exports.readIntBytes = readIntBytes;
exports.writeIntBytes = writeIntBytes;