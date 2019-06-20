/** @module ssz */
import assert from "assert";
import BN from "bn.js";

import {
  FullSSZType,
  Type,
} from "./types";


/** @ignore */
export function assertValidValue(value: any, type: FullSSZType): void {
  switch (type.type) {
    case Type.uint:
      assert(BN.isBN(value) || value === Number(value), 'Invalid uint: not a uint');
      if (value === Infinity) {
        break;
      }
      assert((new BN(value)).gten(0), 'Invalid uint: value < 0');
      assert((new BN(value)).lt((new BN(2)).pow(new BN(type.byteLength * 8))), 'Invalid uint: not in range');
      break;
    case Type.bool:
      assert(value === true || value === false, 'Invalid boolean: not a boolean');
      break;
    case Type.byteList:
      assert(value instanceof Uint8Array || value instanceof Buffer, 'Invalid byte array: not a Uint8Array/Buffer');
      break;
    case Type.byteVector:
      assert(value instanceof Uint8Array || value instanceof Buffer, 'Invalid byte array: not a Uint8Array/Buffer');
      assert(value.length === type.length, 'Invalid byte array: incorrect length');
      break;
    case Type.list:
      assert(Array.isArray(value), 'Invalid list: not an Array');
      value.forEach((element: any, i: number) => {
        try {
          assertValidValue(element, type.elementType);
        } catch (e) {
          throw new Error(`Invalid list, element ${i}: ${e.message}`);
        }
      });
      break;
    case Type.vector:
      assert(Array.isArray(value), 'Invalid vector: not an Array');
      assert(value.length === type.length, 'Invalid vector: incorrect length');
      value.forEach((element: any, i: number) => {
        try {
          assertValidValue(element, type.elementType);
        } catch (e) {
          throw new Error(`Invalid vector, element ${i}: ${e.message}`);
        }
      });
      break;
    case Type.container:
      assert(value === Object(value), 'Invalid container: not an Object');
      type.fields.forEach(([fieldName, fieldType]) => {
        try {
          assert(value[fieldName] !== undefined, "field does not exist");
          assertValidValue(value[fieldName], fieldType);
        } catch (e) {
          throw new Error(`Invalid container, field ${fieldName}: ${e.message}`);
        }
      });
      break;
  }
}
