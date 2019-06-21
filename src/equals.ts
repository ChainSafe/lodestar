/** @module ssz */
import assert from "assert";
import BN from "bn.js";

import {
  AnySSZType,
  FullSSZType,
  Type,
} from "./types";
import { assertValidValue } from "./assertValidValue";
import { parseType } from "./util/types";


/**
 * Equality of two values of an SSZ type
 */
export function equals(value1: any, value2: any, type: AnySSZType): boolean {
  const _type = parseType(type);
  assertValidValue(value1, _type);
  assertValidValue(value2, _type);
  return _equals(value1, value2, _type);
}

/** @ignore */
function _equals(value1: any, value2: any, type: FullSSZType): boolean {
  switch (type.type) {
    case Type.uint:
      return (new BN(value1)).eq(new BN(value2));
    case Type.bool:
      return value1 === value2;
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
