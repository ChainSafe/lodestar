/* eslint-disable @typescript-eslint/no-explicit-any */
/** @module ssz */

import {AnySSZType, FullSSZType, Type, parseType, UintImpl} from "@chainsafe/ssz-type-schema";

import {_assertValidValue} from "./assertValidValue";


/**
 * Equality of two values of an SSZ type
 *
 * Most useful to compare arrays/objects
 *
 * ```typescript
 * equals("number64", 10, 10);
 *
 * equals("bool", true, true);
 *
 * equals(
 *   {
 *     elementType: "byte",
 *     maxLength: 100,
 *   },
 *   Buffer.from("abcd", "hex"),
 *   Buffer.from("abcd", "hex")
 * );
 *
 * equals(
 *   {
 *     elementType: "number32",
 *     maxLength: 10,
 *   },
 *   [0, 1, 2, 3, 4, 5],
 *   [0, 1, 2, 3, 4, 5]
 * );
 *
 * const myDataType: SimpleContainerType = {
 *   fields: [
 *     ["a", "number16"],
 *     ["b", "bool"],
 *     ["c", "bytes96"],
 *   ],
 * };
 * equals(
 *   myDataType,
 *   {a: 10, b: false, c: Buffer.alloc(96)},
 *   {a: 10, b: false, c: Buffer.alloc(96)}
 * );
  * ```
 */
export function equals(type: AnySSZType, value1: any, value2: any): boolean {
  const _type = parseType(type);
  _assertValidValue(_type, value1);
  _assertValidValue(_type, value2);
  return _equals(_type, value1, value2);
}

/** @ignore */
function _equals(type: FullSSZType, value1: any, value2: any): boolean {
  switch (type.type) {
    case Type.uint:
      switch (type.use) {
        case UintImpl.bn:
          return value1.eq(value2);
        case UintImpl.bigint:
        case UintImpl.number:
          return value1 === value2;
      }
      break;
    case Type.bool:
      return value1 === value2;
    case Type.bitList:
    case Type.bitVector:
    case Type.byteList:
    case Type.byteVector:
      return value1.equals(value2);
    case Type.list:
      return value1.length === value2.length &&
        value1.every((element1: any, i: number) => equals(type.elementType, element1, value2[i]));
    case Type.vector:
      return value1.every((element1: any, i: number) => equals(type.elementType, element1, value2[i]));
    case Type.container:
      return type.fields.every(([fieldName, fieldType]) => equals(fieldType, value1[fieldName], value2[fieldName]));
  }
}
