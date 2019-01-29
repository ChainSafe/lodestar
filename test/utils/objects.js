// Adapted from https://github.com/prysmaticlabs/prysm/blob/master/shared/ssz/encode_test.go#L296

const SimpleObject = {
  fields: [
    ['b', 'uint16'],
    ['a', 'uint8'],
  ],
}

const InnerObject = {
  fields: [
    ['v', 'uint16'],
  ],
}

const OuterObject = {
  fields: [
    ['v', 'uint8'],
    ['subV', InnerObject],
  ],
}

const ArrayObject = {
  fields: [
    ['v', [SimpleObject]],
  ],
}

exports.SimpleObject = SimpleObject
exports.InnerObject = InnerObject
exports.OuterObject = OuterObject
exports.ArrayObject = ArrayObject
