// Adapted from https://github.com/prysmaticlabs/prysm/blob/master/shared/ssz/encode_test.go#L296


export const SimpleObject = {
  name: "SimpleObject",
  fields: [
    ['b', 'uint16'],
    ['a', 'uint8'],
  ],
}

export const InnerObject = {
  name: "InnerObject",
  fields: [
    ['v', 'uint16'],
  ],
}

export const OuterObject = {
  name: "OuterObject",
  fields: [
    ['v', 'uint8'],
    ['subV', InnerObject],
  ],
}

export const ArrayObject = {
  name: "ArrayObject",
  fields: [
    ['v', [SimpleObject]],
  ],
}
