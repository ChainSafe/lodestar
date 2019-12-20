/* eslint-disable @typescript-eslint/no-explicit-any */
/** @module ssz */

import {AnySSZType, FullSSZType, parseType, Type, UintImpl} from "@chainsafe/ssz-type-schema";

import {_assertValidValue} from "./assertValidValue";


/**
 * Deeply clone a value of an SSZ type
 *
 * Most useful to clone arrays/objects
 *
 * ```typescript
 * const n: number = clone("number64", 10);
 *
 * const b: boolean = clone("bool", true);
 *
 * const buf: Buffer = clone(
 *   {
 *     elementType: "byte",
 *     maxLength: 10,
 *   },
 *   Buffer.from("abcd", "hex")
 * );
 *
 * const arr: number[] = clone(
 *   {
 *     elementType: "number32",
 *     maxLength: 10,
 *   },
 *   [0, 1, 2, 3, 4, 5]
 * );
 *
 * interface myData {
 *   a: number;
 *   b: boolean;
 *   c: Buffer;
 * }
 * const myDataType: SimpleContainerType = {
 *   fields: [
 *     ["a", "number16"],
 *     ["b", "bool"],
 *     ["c", "bytes96"],
 *   ],
 * };
 * const obj: myData = clone(
 *   myDataType,
 *   {a: 10, b: false, c: Buffer.alloc(96)}
 * );
 * ```
 */
export function clone(type: AnySSZType, value: any): any {
  const _type = parseType(type);
  _assertValidValue(_type, value);
  return _clone(_type, value);
}

/** @ignore */
function _clone(type: FullSSZType, value: any): any {
  const obj: any = {};
  switch (type.type) {
    case Type.uint:
      switch (type.use) {
        case UintImpl.bn:
          return value.clone();
        case UintImpl.bigint:
        case UintImpl.number:
          return value;
      }
      throw new Error("unreachable");
    case Type.bool:
      return value;
    case Type.bitList:
    case Type.bitVector:
      return value.clone();
    case Type.byteList:
    case Type.byteVector:
      return (value as Buffer).slice();
    case Type.list:
    case Type.vector:
      return value.map((element: any) => _clone(type.elementType, element));
    case Type.container:
      type.fields.forEach(([fieldName, fieldType]) => {
        obj[fieldName] = _clone(fieldType, value[fieldName]);
      });
      return obj;
  }
}
