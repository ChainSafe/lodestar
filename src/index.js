const intByteLength = require('./intBytes').intByteLength
const readIntFromBuffer = require('./intBytes').readIntFromBuffer
const writeIntToBuffer = require('./intBytes').writeIntToBuffer
const deepCopy = require('deepcopy')
const keccakAsU8a = require('@polkadot/util-crypto').keccakAsU8a

// Number of bytes used for the length added before a variable-length serialized object.
const LENGTH_BYTES = 4
// Number of bytes for the chunk size of the Merkle tree leaf.
const SSZ_CHUNK_SIZE = 128

/**
 * Simply Serializes, as specified [here](https://github.com/ethereum/eth2.0-specs/blob/master/specs/simple-serialize.md#serializeencode)
 * @method serialize
 * @param {Array|BN|boolean|Buffer|number|object} value - value to serialize
 * @param {Array|string|object} type - type of value to serialize: A string ('bool', 'uintN','bytesN', 'bytes'), an Array [type], or object containing a `fields` property
 * @return {Buffer} serialized value
 */
function serialize (value, type) {
  // serialize bool
  if (type === 'bool') {
    let result = Buffer.alloc(1)
    result.writeInt8(value ? 1 : 0)
    return result
  }

  // serialize integers (incl. BNs)
  if ((typeof type === 'string') && !!type.match(/^u?int\d+$/g)) {
    // determine int size
    const byteLength = intByteLength(type)

    // return bytes
    let buffer = Buffer.alloc(byteLength)
    writeIntToBuffer(buffer, value, byteLength)
    return buffer
  }

  // serialize bytesN
  if ((typeof type === 'string') && !!type.match(/^bytes\d+$/g)) {
    let bytesSize = parseInt(type.match(/\d+/g))
    // check byte length
    if (value.byteLength !== bytesSize) {
      throw Error(`given ${type} ${value} should be ${bytesSize} bytes`)
    }
    return value
  }

  // serialize bytes
  if (type === 'bytes') {
    // return (length + bytes)
    let byteLengthBuffer = Buffer.alloc(4)
    // write length to buffer as 4 byte int
    byteLengthBuffer.writeUInt32LE(value.byteLength) // little endian
    // write bytes to buffer
    return Buffer.concat([byteLengthBuffer, value])
  }

  // serialize array of a specified type
  if (Array.isArray(value) && Array.isArray(type)) {
    // only 1 element type is allowed
    if (type.length > 1) {
      throw Error('array type should only have one element type')
    }

    // serialize each element of the array
    let elementType = type[0]
    let serializedValues = value.map((element) => serialize(element, elementType))
    let totalByteLength = serializedValues.reduce((acc, v) => acc + v.byteLength, 0)

    // write length to buffer as 4 byte int
    let byteLengthBuffer = Buffer.alloc(4)
    byteLengthBuffer.writeUInt32LE(totalByteLength) // little endian

    // start from end of the length number (4 bytes)
    let ass = serializedValues.map((ab) => Buffer.from(ab))
    return Buffer.concat([byteLengthBuffer, ...ass], totalByteLength + 4)
  }

  // serializes objects (including compound objects)
  if ((typeof type === 'object' || typeof type === 'function') && type.hasOwnProperty('fields')) {
    const buffers = type.fields
      .map(([fieldName, fieldType]) => {
        return serialize(value[fieldName], fieldType)
      })

    let totalByteLength = buffers.reduce((acc, v) => acc + v.byteLength, 0)
    let byteLengthBuffer = Buffer.alloc(4)
    byteLengthBuffer.writeUInt32LE(totalByteLength) // little endian

    return Buffer.concat([byteLengthBuffer, ...buffers])
  }

  // cannot serialize
  throw new Error(`Unrecognized type: ${type}`)
}

/**
 * Simply Deserializes, as specified [here](https://github.com/ethereum/eth2.0-specs/blob/master/specs/simple-serialize.md#deserializedecode)
 * @method deserialize
 * @param {Buffer} data - byte array to deserialize
 * @param {Array|string|object} type - type of value to deserialize: A string ('bool', 'uintN','bytesN', 'bytes'), an Array [type], or object containing a `fields` property
 * @param {number} [start=0] - starting offset index in data
 * @return {object} deserialized value object: {deserializedData, offset}
 */
function deserialize (data, type, start = 0) {
  // deserializes booleans
  if (type === 'bool') {
    let intResult = readIntFromBuffer(data, 1, start)
    if (intResult === 0 || intResult === 1) {
      return {
        deserializedData: intResult === 1,
        offset: start + 1
      }
    }
  }

  // deserializes unsigned integers
  if ((typeof type === 'string') && !!type.match(/^u?int\d+$/g)) {
    // determine int size
    const byteLength = intByteLength(type)
    assertEnoughBytes(data, start, byteLength)

    return {
      deserializedData: readIntFromBuffer(data, byteLength, start),
      offset: start + byteLength
    }
  }

  // deserializes bytesN
  if ((typeof type === 'string') && !!type.match(/^bytes\d+$/g)) {
    let bytesSize = parseInt(type.match(/\d+/g))

    assertEnoughBytes(data, start, bytesSize)

    return {
      deserializedData: data.slice(start, (start + bytesSize)),
      offset: start + bytesSize
    }
  }

  // deserialize bytes
  if (type === 'bytes') {
    let length = readIntFromBuffer(data, LENGTH_BYTES, start)

    assertEnoughBytes(data, start, LENGTH_BYTES + length)

    return {
      deserializedData: data.slice(start + LENGTH_BYTES, (start + LENGTH_BYTES + length)),
      offset: start + LENGTH_BYTES + length
    }
  }

  // deserializes array of a specified type
  if (Array.isArray(type)) {
    // only 1 element type is allowed
    if (type.length > 1) {
      throw Error('array type should only have one element type')
    }

    // deserialize each element of the array
    let elementType = type[0]

    let length = readIntFromBuffer(data, LENGTH_BYTES, start)
    let output = []
    let position = start + LENGTH_BYTES

    // work through the data deserializing the array elements
    while (position < (start + LENGTH_BYTES + length)) {
      let response = deserialize(data, elementType, position)
      position = response.offset
      output.push(response.deserializedData)
    }

    // check that we have have arrived at the end of the byte stream
    if (position !== (start + LENGTH_BYTES + length)) {
      throw Error('We did not arrive at the end of the byte length')
    }

    return {
      deserializedData: output,
      offset: position
    }
  }

  // deserializes objects (including compound objects)
  if ((typeof type === 'object' || typeof type === 'function') && type.hasOwnProperty('fields')) {
    let output = {}
    let position = start + LENGTH_BYTES

    type.fields
      .forEach(([fieldName, fieldType]) => {
        let fieldResult = deserialize(data, fieldType, position)
        position = fieldResult.offset
        output[fieldName] = fieldResult.deserializedData
      })

    return {
      deserializedData: output,
      offset: position
    }
  }

  // cannot deserialize
  throw new Error(`Unrecognized type: ${type}`)
}

function treeHashInternal (value, type) {
  if (typeof type === 'string') {
    // bool
    // bytes
    if (type === 'bool') {
      return serialize(value, type)
      // uint
    } else if (type.match(/^u?int\d+$/g)) {
      const bitSize = parseInt(type.match(/\d+/g))
      if (bitSize <= 256) {
        return serialize(value, type)
      } else {
        return hash(serialize(value, type))
      }
      // bytesN
    } else if (type.match(/^bytes\d+$/g)) {
      const bytesSize = parseInt(type.match(/\d+/g))
      if (bytesSize <= 32) {
        return serialize(value, type)
      } else {
        return hash(serialize(value, type))
      }
      // bytes
    } else if (type === 'bytes') {
      return hash(serialize(value, type))
    } else {
      throw Error(`Unable to hash: unknown type ${type}`)
    }
  } else if (Array.isArray(value) && Array.isArray(type)) {
    const elementType = type[0]
    return merkleHash(value.map(v => treeHashInternal(v, elementType)))
  } else if ((typeof type === 'object' || typeof type === 'function') && type.hasOwnProperty('fields')) {
    return merkleHash(type.fields.map(([fieldName, fieldType]) => treeHashInternal(value[fieldName], fieldType)))
  }
}

/**
 * Returns a tree hash of a simple-serializable value, as specified [here](https://github.com/ethereum/eth2.0-specs/blob/master/specs/simple-serialize.md#tree-hash)
 * @method treeHash
 * @param {Array|boolean|Buffer|number|object} value - Value to hash
 * @param {Array|string|object} type - The type of the value to hash: A string ('bool', 'uintN','bytesN', 'bytes'), an Array [type], or object containing a `fields` property
 * @return {Buffer} the hash, length <= 32
 */
function treeHash (value, type) {
  return zpad(treeHashInternal(value, type), 32)
}

/**
 * Checks if two serialized objects are equal by value
 * @method eq
 * @param {Buffer} x - serialized object
 * @param {Buffer} y - serialized object
 * @return {boolean} x equals y
 */
function eq (x, y) {
  // Since we serialized x and y as buffers and buffers in JS are deterministic, we can do the following
  return x.equals(y)
}

/**
 * Returns a deep copy of a serialized object
 * @method deepcopy
 * @param {Buffer} x - Value to deep copy
 * @return {Buffer} the deep copy of x
 */
function deepcopy (x) {
  return deepCopy(x)
}

function assertEnoughBytes (data, start, length) {
  if (data.byteLength < start + length) {
    throw Error('Data bytes is not enough for data type')
  }
}

// Merkle tree hash of a list of homogenous, non-empty items
function merkleHash (list) {
  // Store length of list (to compensate for non-bijectiveness of padding)
  const dataLen = Buffer.alloc(32)
  dataLen.writeUInt32LE(list.length) // little endian
  let chunkz
  if (list.length === 0) {
    chunkz = [Buffer.alloc(SSZ_CHUNK_SIZE)]
  } else if (list[0].length < SSZ_CHUNK_SIZE) {
    // See how many items fit in a chunk
    const itemsPerChunk = Math.floor(SSZ_CHUNK_SIZE / list[0].length)

    // Build a list of chunks based on the number of items in the chunk
    chunkz = []
    for (let i = 0; i < list.length; i += itemsPerChunk) {
      chunkz.push(zpad(Buffer.concat(list.slice(i, i + itemsPerChunk)), SSZ_CHUNK_SIZE))
    }
  } else {
    chunkz = list
  }

  const bitLength = (x) => {
    let numBits = 0
    while (x !== 0) {
      x = x >> 1
      numBits++
    }
    return numBits
  }
  const nextPowerOf2 = (x) => x === 0 ? 1 : Math.pow(2, bitLength(x - 1))
  // Add zeroed chunks as leaf nodes to create full binary tree
  chunkz = chunkz.concat(
    Array.from({ length: nextPowerOf2(chunkz.length) - chunkz.length },
      () => Buffer.alloc(SSZ_CHUNK_SIZE)))
  // Merkleise
  while (chunkz.length > 1) {
    const chunkz2 = []
    for (let i = 0; i < chunkz.length; i += 2) {
      chunkz2.push(hash(Buffer.concat([chunkz[i], chunkz[i + 1]])))
    }
    chunkz = chunkz2
  }

  // Return hash of root and length data
  return hash(Buffer.concat([chunkz[0], dataLen]))
}

function hash (x) {
  return Buffer.from(keccakAsU8a(x))
}

function zpad (input, length) {
  if (input.length < length) {
    return Buffer.concat([input, Buffer.alloc(length - input.length)])
  }
  return input
}

exports.serialize = serialize
exports.deserialize = deserialize
exports.eq = eq
exports.deepcopy = deepcopy
exports.merkleHash = merkleHash
exports.treeHash = treeHash
