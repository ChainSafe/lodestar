const BN = require('bn.js')

function intByteLength (type) {
  let intSize = parseInt(type.match(/\d+/g))
  return intSize / 8
}

function readIntBytes (type) {
  let intSize = parseInt(type.match(/\d+/g))
  let byteSize = intSize / 8

  return (buffer, offset) => {
    let bnResult = new BN([...buffer.slice(offset, (offset + byteSize))], 16, 'be').fromTwos(intSize)
    return intSize <= 32 ? bnResult.toNumber() : bnResult
  }
}

function writeIntBytes (type) {
  let intSize = parseInt(type.match(/\d+/g))
  let byteSize = intSize / 8
  return (buffer, value) => { new BN(value).toTwos(intSize).toBuffer('be', byteSize).copy(buffer) }
}

exports.intByteLength = intByteLength
exports.readIntBytes = readIntBytes
exports.writeIntBytes = writeIntBytes
