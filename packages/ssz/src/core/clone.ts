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
 * const n: number = clone(10, "number64");
 *
 * const b: boolean = clone(true, "bool");
 *
 * const buf: Buffer = clone(
 *   Buffer.from("abcd", "hex"),
 *   {
 *     elementType: "byte",
 *     maxLength: 10,
 *   }
 * );
 *
 * const arr: number[] = clone(
 *   [0, 1, 2, 3, 4, 5],
 *   {
 *     elementType: "number32",
 *     maxLength: 10,
 *   }
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
 *   {a: 10, b: false, c: Buffer.alloc(96)},
 *   myDataType
 * );
 * ```
 */
export function clone(value: any, type: AnySSZType): any {
  const _type = parseType(type);
  _assertValidValue(value, _type);
  return _clone(value, _type);
}

/** @ignore */
function _clone(value: any, type: FullSSZType): any {
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
      return value.map((element: any) => clone(element, type.elementType));
    case Type.container:
      type.fields.forEach(([fieldName, fieldType]) => {
        obj[fieldName] = clone(value[fieldName], fieldType);
      });
      return obj;
  }
}
