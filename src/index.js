const intByteLength = require('./intBytes').intByteLength
const readIntBytes = require('./intBytes').readIntBytes
const writeIntBytes = require('./intBytes').writeIntBytes
const deepCopy = require('deepcopy')

/**
 * Simply Serializes (SSZ)
 * @method serialize
 * @param {boolean|Buffer|array|number|object} value - Value to serialize: boolean | int8/16/24/32 | bytesN (Buffer) | bytes (Buffer) | array | object
 * @param {string|object} type - A type string ('bool', 'int8', 'int16', 'int24', 'int32', `bytes${N}`, 'bytes'), or type array ['bytes32'], or type object containing fields property
 * @return {Buffer} the byte output
 */
function serialize (value, type) {
  // serialize bool
  if (type === 'bool') {
    let result = Buffer.alloc(1)
    result.writeInt8(value ? 1 : 0)
    return result
  }

  // serialize integers
  if ((typeof type === 'string') && !!type.match(/^u?int\d+$/g)) {
    // determine int size
    let intSize = parseInt(type.match(/\d+/g))
    if (intSize > 0 && intSize <= 256 && intSize % 8 !== 0) {
      throw Error(`given int type has invalid size (8, 16, 24, 32, 64, 256)`)
    }

    // return bytes
    let buffer = Buffer.alloc(intSize / 8)
    writeIntBytes(type)(buffer, value)
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
    byteLengthBuffer.writeUInt32BE(value.byteLength) // bigendian
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
    byteLengthBuffer.writeUInt32BE(totalByteLength) // bigendian

    // start from end of the length number (4 bytes)
    let ass = serializedValues.map((ab) => Buffer.from(ab))
    return Buffer.concat([byteLengthBuffer, ...ass], totalByteLength + 4)
  }

  // serializes objects (including compound objects)
  if ((typeof type === 'object' || typeof type === 'function') && type.hasOwnProperty('fields')) {
    let buffers = []
    Object.keys(type.fields)
      .sort()
      .forEach(fieldName => {
        buffers.push(serialize(value[fieldName], type.fields[fieldName]))
      })

    let totalByteLength = buffers.reduce((acc, v) => acc + v.byteLength, 0)
    let byteLengthBuffer = Buffer.alloc(4)
    byteLengthBuffer.writeUInt32BE(totalByteLength) // bigendian

    return Buffer.concat([byteLengthBuffer, ...buffers])
  }

  // cannot serialize
  return null
}

/**
 * Simply Deserializes (SSZ)
 * @method deserialize
 * @param {Buffer} data bytes (buffer) to deserialize
 * @param {string|object} type - A type string ('bool', 'int8', 'int16', 'int24, 'int32', `bytes${N}`, 'bytes'), or type array ['bytes32'], or type object containing fields property
 * @return {Buffer|array|number|object} deserialized value : boolean | int8/16/32/64/256 | uint8/16/32/64/256 | bytesN (Buffer) | bytes (Buffer) | array | object
 */
function deserialize (data, start, type) {
  const int32ByteLength = intByteLength('int32')

  // deserializes booleans
  if (type === 'bool') {
    let intResult = readIntBytes('int8')(data, start)
    if (intResult === 0 || intResult === 1) {
      return {
        deserializedData: intResult === 1,
        offset: start + intByteLength('int8')
      }
    }
  }

  // deserializes unsigned integers
  if ((typeof type === 'string') && !!type.match(/^u?int\d+$/g)) {
    // determine int size
    let intSize = parseInt(type.match(/\d+/g))
    if (intSize > 0 && intSize <= 32 && intSize % 8 !== 0) {
      throw Error(`given int type has invalid size (8, 16, 24, 32)`)
    }

    assertEnoughBytes(data, start, intByteLength(type))

    return {
      deserializedData: readIntBytes(type)(data, start),
      offset: start + intByteLength(type)
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
    let length = readIntBytes('int32')(data, start)

    assertEnoughBytes(data, start, int32ByteLength + length)

    return {
      deserializedData: data.slice(start + int32ByteLength, (start + length + int32ByteLength)),
      offset: start + int32ByteLength + length
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

    let length = readIntBytes('int32')(data, start)
    let output = []
    let position = start + int32ByteLength

    // work through the data deserializing the array elements
    while (position < (start + int32ByteLength + length)) {
      let response = deserialize(data, position, elementType)
      position = response.offset
      output.push(response.deserializedData)
    }

    // check that we have have arrived at the end of the byte stream
    if (position !== (start + int32ByteLength + length)) {
      throw Error('We did not arrive at the end of the byte length')
    }

    return {
      deserializedData: output,
      offset: position
    }
  }

  // deserializes objects (including compound objects)
  if ((typeof type === 'object' || typeof type === 'function') && type.hasOwnProperty('fields')) {
    // let length = readIntBytes('int32')(data, start)
    let output = {}
    let position = start + int32ByteLength

    Object.keys(type.fields)
      .sort()
      .forEach(fieldName => {
        let fieldResult = deserialize(data, position, type.fields[fieldName])
        position = fieldResult.offset
        output[fieldName] = fieldResult.deserializedData
      })

    return {
      deserializedData: output,
      offset: position
    }
  }

  return null
}

/**
 * Checks if 2 simply serialized objects are equal (SSZ)
 * @method eq
 * @param {Buffer} x - simply serialized object
 * @param {Buffer} y - simply serialized object
 * @return {Bool} the byte output
 */
function eq (x, y) {
  // Since we serialized x and y as buffers and buffers in JS are deterministic, we can do the following
  return x.equals(y)
}

/**
 * Returns a deep copy of a simply serialized object (SSZ)
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

exports.serialize = serialize
exports.deserialize = deserialize
exports.eq = eq
exports.deepcopy = deepcopy
