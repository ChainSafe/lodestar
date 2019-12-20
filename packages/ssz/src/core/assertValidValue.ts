/* eslint-disable @typescript-eslint/no-explicit-any */
/** @module ssz */
import assert from "assert";
import {BitList, BitVector} from "@chainsafe/bit-utils";
import BN from "bn.js";

import {
  AnySSZType,
  FullSSZType,
  Type,
  parseType,
  UintImpl
} from "@chainsafe/ssz-type-schema";


/**
 * Assert that value is valid for the type.
 *
 * Throws an [[Error]] if the value is invalid.
 *
 * ```typescript
 * const myDataType: SimpleContainerType = {
 *   fields: [
 *     ["a", "number16"],
 *     ["b", "bool"],
 *     ["c", "bytes96"],
 *   ],
 * };
 *
 * assertValidValue(myDataType, {
 *   a: 10,
 *   b: true,
 *   c: Buffer.alloc(96),
 * }); // no error
 *
 * assertValidValue(myDataType, {
 *   a: 10,
 *   b: true,
 *   c: 10, // errors, expects Buffer, length 96
 * }); // error because of `c`
 * ```
 */
export function assertValidValue(type: AnySSZType, value: any): void {
  _assertValidValue(parseType(type), value);
}

/** @ignore */
export function _assertValidValue(type: FullSSZType, value: any): void {
  switch (type.type) {
    case Type.uint:
      switch (type.use) {
        case UintImpl.bn:
          assert(BN.isBN(value), "Invalid uint: not a BN");
          assert(value.gten(0), "Invalid uint: value < 0");
          assert(value.lt((new BN(2)).pow(new BN(type.byteLength * 8))), "Invalid uint: not in range");
          return;
        case UintImpl.bigint:
          assert(typeof value === "bigint", "Invalid uint: not a bigint");
          assert(value >= 0, "Invalid uint: value < 0");
          assert(value < BigInt(2)**BigInt(type.byteLength * 8), "Invalid uint: not in range");
          return;
        case UintImpl.number:
          assert(typeof value === "number", "Invalid uint: not a number");
          if (value === Infinity) {
            return;
          }
          assert(value >= 0, "Invalid uint: value < 0");
          assert(value < BigInt(2)**BigInt(type.byteLength * 8), "Invalid uint: not in range");
          return;
      }
      break;
    case Type.bool:
      assert(value === true || value === false, "Invalid boolean: not a boolean");
      break;
    case Type.bitList:
      assert(BitList.isBitList(value), "Invalid BitList: not a BitList");
      assert(value.bitLength <= type.maxLength, "Invalid BitList: longer than max length");
      break;
    case Type.bitVector:
      assert(BitVector.isBitVector(value), "Invalid BitVector: not a BitVector");
      assert(value.bitLength === type.length, "Invalid BitVector: incorrect length");
      break;
    case Type.byteList:
      assert(value instanceof Uint8Array || value instanceof Buffer, "Invalid byte array: not a Uint8Array/Buffer");
      assert(value.length <= type.maxLength, "Invalid byte array: longer than max length");
      break;
    case Type.byteVector:
      assert(value instanceof Uint8Array || value instanceof Buffer, "Invalid byte array: not a Uint8Array/Buffer");
      assert(value.length === type.length, "Invalid byte array: incorrect length");
      break;
    case Type.list:
      assert(Array.isArray(value), "Invalid list: not an Array");
      assert(value.length <= type.maxLength, "Invalid list: longer than max length");
      value.forEach((element: any, i: number) => {
        try {
          _assertValidValue(type.elementType, element);
        } catch (e) {
          throw new Error(`Invalid list, element ${i}: ${e.message}`);
        }
      });
      break;
    case Type.vector:
      assert(Array.isArray(value), "Invalid vector: not an Array");
      assert(value.length === type.length, "Invalid vector: incorrect length");
      value.forEach((element: any, i: number) => {
        try {
          _assertValidValue(type.elementType, element);
        } catch (e) {
          throw new Error(`Invalid vector, element ${i}: ${e.message}`);
        }
      });
      break;
    case Type.container:
      assert(value === Object(value), "Invalid container: not an Object");
      type.fields.forEach(([fieldName, fieldType]) => {
        try {
          assert(value[fieldName] !== undefined, "field does not exist");
          _assertValidValue(fieldType, value[fieldName]);
        } catch (e) {
          throw new Error(`Invalid container, field ${fieldName}: ${e.message}`);
        }
      });
      break;
  }
}
