import assert from "assert";

import {
  ByteArray,
  ObjectType,
  SerializableArray,
  SerializableList,
  SerializableType,
  SerializableValue,
  SerializableObject,
} from "./types";

import {
  merkleize,
  mixInLength,
  pack,
} from "./util/hash";

import {
  bytesPattern,
  uintPattern,
} from "./util/types";

/**
 * Merkleize an SSZ value
 * @method hashTreeRoot
 * @param {SerializableValue} value
 * @param {SerializableType} type
 * @returns {Buffer}
 */
export function hashTreeRoot(value: SerializableValue, type: SerializableType): Buffer {
  if (typeof type === "string") {
    if (type === "bool") {
      return merkleize(pack([value], type));
    }
    if (type === "bytes") {
      return mixInLength(
        merkleize(pack([value], type)),
        (value as ByteArray).length);
    }
    if (type.match(bytesPattern)) {
      return merkleize(pack([value], type));
    }
    if (type.match(uintPattern)) {
      return merkleize(pack([value], type));
    }
  } else if (Array.isArray(type)) {
    assert((value as SerializableArray).length !== undefined, `Invalid array value: ${value}`);
    assert(type.length <= 2, `Invalid array type: ${type}`);
    const elementType = type[0];
    if (elementType === "byte") {
      if (type.length === 1) {
        return mixInLength(
          merkleize(pack([value], type)),
          (value as ByteArray).length);
      } else { // type.length === 2
        return merkleize(pack([value], type));
      }
    }
    value = value as SerializableList;
    if (type.length === 1) {
      return mixInLength(
        merkleize(value.map((v) => hashTreeRoot(v, elementType))),
        value.length);
    }
    if (type.length === 2) {
      if (typeof elementType === "string") {
        return merkleize(pack(value, elementType));
      } else {
        return merkleize(value.map((v) => hashTreeRoot(v, elementType)));
      }
    }
  } else if (typeof type === "object") {
    return merkleize((type as ObjectType).fields
      .map(([fieldName, fieldType]) => hashTreeRoot((value as SerializableObject)[fieldName], fieldType)));
  }
  throw new Error(`Invalid type: ${type}`);
}
