// Adapted from https://github.com/prysmaticlabs/prysm/blob/master/shared/ssz/encode_test.go#L296

import { ObjectType } from "../src/types";

export const SimpleObject: ObjectType = {
  name: "SimpleObject",
  fields: [
    ['b', 'uint16'],
    ['a', 'uint8'],
  ],
}

export const InnerObject: ObjectType = {
  name: "InnerObject",
  fields: [
    ['v', 'uint16'],
  ],
}

export const OuterObject: ObjectType = {
  name: "OuterObject",
  fields: [
    ['v', 'uint8'],
    ['subV', InnerObject],
  ],
}

export const ArrayObject: ObjectType = {
  name: "ArrayObject",
  fields: [
    ['v', [SimpleObject]],
  ],
}
