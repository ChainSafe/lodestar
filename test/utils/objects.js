// Adapted from https://github.com/prysmaticlabs/prysm/blob/master/shared/ssz/encode_test.go#L296

class SimpleObject {
  constructor(opts) {
    Object.keys(opts)
      .forEach(key => this[key] = opts[key])
  }
}
SimpleObject.fields = [
  ['b', 'uint16'],
  ['a', 'uint8'],
]

class InnerObject {
  constructor(opts) {
    Object.keys(opts)
      .forEach(key => this[key] = opts[key])
  }
}
InnerObject.fields = [
  ['v', 'uint16'],
]

class OuterObject {
  constructor(opts) {
    Object.keys(opts)
      .forEach(key => this[key] = opts[key])
  }
}
OuterObject.fields = [
  ['v', 'uint8'],
  ['subV', InnerObject],
]

class ArrayObject {
  constructor(opts) {
    Object.keys(opts)
      .forEach(key => this[key] = opts[key])
  }
}
ArrayObject.fields = [
  ['v', [SimpleObject]],
]

exports.SimpleObject = SimpleObject
exports.InnerObject = InnerObject
exports.OuterObject = OuterObject
exports.ArrayObject = ArrayObject
