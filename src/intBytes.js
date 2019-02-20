const BN = require('bn.js')

/**
 * Counts number of bytes in an integer
 * @ignore
 * @param type
 * @returns {number}
 */
function intByteLength (type) {
  const bits = parseInt(type.match(/\d+/g))
  if (bits < 0 || bits % 8 !== 0) {
    throw Error('given int type has invalid size, must be size > 0 and size % 8 == 0')
  }
  return bits / 8
}

function readIntFromBuffer (buffer, byteSize, offset = 0) {
  const bnResult = new BN(buffer.slice(offset, (offset + byteSize)), 16, 'le').fromTwos(byteSize * 8)
  return byteSize <= 4 ? bnResult.toNumber() : bnResult
}

function writeIntToBuffer (buffer, value, byteSize, offset = 0) {
  new BN(value).toTwos(byteSize * 8).toArrayLike(Buffer, 'le', byteSize).copy(buffer, offset)
}

exports.intByteLength = intByteLength
exports.readIntFromBuffer = readIntFromBuffer
exports.writeIntToBuffer = writeIntToBuffer
