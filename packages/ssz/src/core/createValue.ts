/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "assert";
import {AnySSZType, FullSSZType, parseType, Type} from "@chainsafe/ssz-type-schema";

import {assertValidValue} from "./assertValidValue";
import {defaultValue} from "./defaultValue";

/**
 * Given an ssz type, create an empty value, optionally filled in with a default value
 *
 * The default value can be only partially specified.
 */
export function createValue<T>(type: AnySSZType<T>, value: any = null): T {
  return _createValue(parseType(type), value) as T;
}

function _createValue(type: FullSSZType, value: any = null): any {
  switch(type.type) {
    case Type.uint:
    case Type.bool:
    case Type.bitList:
    case Type.bitVector:
    case Type.byteList:
    case Type.byteVector:
      if (value !== null && value !== undefined) {
        assertValidValue(value, type);
        return value;
      } else {
        return defaultValue(type);
      }
    case Type.list:
      if (value) {
        assert(Array.isArray(value));
      } else {
        value = [];
      }
      return value.map((v: any) =>
        _createValue(type.elementType, v));
    case Type.vector:
      if (value) {
        assert(Array.isArray(value));
      } else {
        value = [];
      }
      return Array.from({length: type.length}, (_, i) =>
        _createValue(type.elementType, value[i]));
    case Type.container:
      if (value) {
        assert(Object(value) === value);
      } else {
        value = {};
      }
      // eslint-disable-next-line no-case-declarations
      const obj: Record<string, any> = {};
      type.fields.forEach(([fieldName, fieldType]) => {
        obj[fieldName] = _createValue(fieldType, value[fieldName]);
      });
      return obj;
  }
}
