/** @module ssz */
import assert from "assert";
import BN from "bn.js";
import {BitList, BitVector} from "@chainsafe/bit-utils";

import {
  AnySSZType,
  FullSSZType,
  Type,
} from "./types";

import {parseType} from "./util/types";


/**
 * Assert that value is valid for the type.
 *
 * Throws an [[Error]] if the value is invalid.
 *
 * ```typescript
 * const myDataType: SimpleContainerType = {
 *   fields: [
 *     ["a", "uint16"],
 *     ["b", "bool"],
 *     ["c", "bytes96"],
 *   ],
 * };
 *
 * assertValidValue({
 *   a: 10,
 *   b: true,
 *   c: Buffer.alloc(96),
 * }, myDataType); // no error
 *
 * assertValidValue({
 *   a: 10,
 *   b: true,
 *   c: 10, // errors, expects Buffer, length 96
 * }, myDataType); // error because of `c`
 * ```
 */
export function assertValidValue(value: any, type: AnySSZType): void {
  _assertValidValue(value, parseType(type));
}

/** @ignore */
export function _assertValidValue(value: any, type: FullSSZType): void {
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
    case Type.bitList:
      assert(BitList.isBitList(value), 'Invalid BitList: not a BitList');
      assert(value.bitLength <= type.maxLength, 'Invalid BitList: longer than max length');
      break;
    case Type.bitVector:
      assert(BitVector.isBitVector(value), 'Invalid BitVector: not a BitVector');
      assert(value.bitLength === type.length, 'Invalid BitVector: incorrect length');
      break;
    case Type.byteList:
      assert(value instanceof Uint8Array || value instanceof Buffer, 'Invalid byte array: not a Uint8Array/Buffer');
      assert(value.length <= type.maxLength, 'Invalid byte array: longer than max length');
      break;
    case Type.byteVector:
      assert(value instanceof Uint8Array || value instanceof Buffer, 'Invalid byte array: not a Uint8Array/Buffer');
      assert(value.length === type.length, 'Invalid byte array: incorrect length');
      break;
    case Type.list:
      assert(Array.isArray(value), 'Invalid list: not an Array');
      assert(value.length <= type.maxLength, 'Invalid list: longer than max length');
      value.forEach((element: any, i: number) => {
        try {
          _assertValidValue(element, type.elementType);
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
          _assertValidValue(element, type.elementType);
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
          _assertValidValue(value[fieldName], fieldType);
        } catch (e) {
          throw new Error(`Invalid container, field ${fieldName}: ${e.message}`);
        }
      });
      break;
  }
}
