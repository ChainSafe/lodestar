import assert from "assert";

import {
  ArrayType,
  Bytes,
  BytesType,
  FullSSZType,
  SerializableArray,
  SerializableObject,
  SerializableValue,
  Type,
} from "./types";

import { BYTES_PER_LENGTH_PREFIX } from "./constants";


function _sizeByteArray(value: Bytes, type: BytesType): number {
  const length = (type as any).length || value.length;
  return length + BYTES_PER_LENGTH_PREFIX;
}

export function size(value: any, type: FullSSZType): number {
  switch (type.type) {
    case Type.uint:
      return type.byteLength;
    case Type.bool:
      assert(value === true || value === false, `Invalid bool value: ${value}`);
      return 1;
    case Type.byteList:
    case Type.byteVector:
      value = value as Bytes;
      assert(value.length !== undefined, `Invalid byte array value: ${value}`);
      return _sizeByteArray(value, type);
    case Type.list:
    case Type.vector:
      assert((value as SerializableArray).length !== undefined, `Invalid array value: ${value}`);
      return (value as SerializableArray)
        .map((v) => size(v, (type as ArrayType).elementType))
        .reduce((a, b) => a + b, 0) + BYTES_PER_LENGTH_PREFIX;
    case Type.container:
      assert(value === Object(value), `Invalid object value: ${value}`);
      return type.fields
        .map(([fieldName, fieldType]) => size((value as SerializableObject)[fieldName], fieldType))
        .reduce((a, b) => a + b, 0) + BYTES_PER_LENGTH_PREFIX;
  }
}
