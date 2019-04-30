import assert from "assert";
import BN from "bn.js";

import {
  FullSSZType,
  Type,
} from "./types";


export function assertValidValue(value: any, type: FullSSZType): void {
  switch (type.type) {
    case Type.uint:
      assert(BN.isBN(value) || value === Number(value), 'Invalid uint value')
      break;
    case Type.bool:
      assert(value === true || value === false, 'Invalid boolean value');
      break;
    case Type.byteList:
      assert(value instanceof Uint8Array, 'Invalid byte array value');
      break;
    case Type.byteVector:
      assert(value instanceof Uint8Array, 'Invalid byte array value');
      assert(value.length === type.length, 'Invalid byte array length');
      break;
    case Type.list:
      assert(Array.isArray(value), 'Invalid array value');
      break;
    case Type.vector:
      assert(Array.isArray(value), 'Invalid array value');
      assert(value.length === type.length, 'Invalid array length');
      break;
    case Type.container:
      assert(value === Object(value), 'Invalid object value');
      break;
  }
}
