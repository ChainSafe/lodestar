/** @module ssz */
import assert from "assert";
import BN from "bn.js";

import {
  AnySSZType,
  FullSSZType,
  Type,
} from "./types";
import {_assertValidValue} from "./assertValidValue";
import {parseType} from "./util/types";


/**
 * Equality of two values of an SSZ type
 *
 * Most useful to compare arrays/objects
 *
 * ```typescript
 * equals(10, 10, "uint64");
 *
 * equals(true, true, "bool");
 *
 * equals(
 *   Buffer.from("abcd", "hex"),
 *   Buffer.from("abcd", "hex"),
 *   {
 *     elementType: "byte",
 *     maxLength: 100,
 *   }
 * );
 *
 * equals(
 *   [0, 1, 2, 3, 4, 5],
 *   [0, 1, 2, 3, 4, 5],
 *   {
 *     elementType: "uint32",
 *     maxLength: 10,
 *   }
 * );
 *
 * const myDataType: SimpleContainerType = {
 *   fields: [
 *     ["a", "uint16"],
 *     ["b", "bool"],
 *     ["c", "bytes96"],
 *   ],
 * };
 * equals(
 *   {a: 10, b: false, c: Buffer.alloc(96)},
 *   {a: 10, b: false, c: Buffer.alloc(96)},
 *   myDataType
 * );
  * ```
 */
export function equals(value1: any, value2: any, type: AnySSZType): boolean {
  const _type = parseType(type);
  _assertValidValue(value1, _type);
  _assertValidValue(value2, _type);
  return _equals(value1, value2, _type);
}

/** @ignore */
function _equals(value1: any, value2: any, type: FullSSZType): boolean {
  switch (type.type) {
    case Type.uint:
      if(value1 === Infinity || value2 === Infinity) {
        return value1 === value2;
      }
      return (new BN(value1)).eq(new BN(value2));
    case Type.bool:
      return value1 === value2;
    case Type.bitList:
    case Type.bitVector:
    case Type.byteList:
    case Type.byteVector:
      return value1.equals(value2);
    case Type.list:
      return value1.length === value2.length &&
        value1.every((element1: any, i: number) => equals(element1, value2[i], type.elementType));
    case Type.vector:
      return value1.every((element1: any, i: number) => equals(element1, value2[i], type.elementType));
    case Type.container:
      return type.fields.every(([fieldName, fieldType]) => equals(value1[fieldName], value2[fieldName], fieldType));
  }
}
