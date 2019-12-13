/* eslint-disable @typescript-eslint/no-explicit-any */
import {AnySSZType, FullSSZType, parseType, Type, UintImpl} from "@chainsafe/ssz-type-schema";
import {BitList, BitVector} from "@chainsafe/bit-utils";
import BN from "bn.js";

export function defaultValue<T>(type: AnySSZType<T>): T {
  return _defaultValue(parseType(type)) as T;
}

export function _defaultValue(type: FullSSZType): any {
  switch (type.type) {
    case Type.bool:
      return false;
    case Type.uint:
      switch (type.use) {
        case UintImpl.bn:
          return new BN(0);
        case UintImpl.bigint:
          return BigInt(0);
        case UintImpl.number:
          return 0;
      }
      break;
    case Type.bitList:
      return BitList.fromBitfield(Buffer.alloc(0), 0);
    case Type.bitVector:
      return BitVector.fromBitfield(
        Buffer.alloc(Math.max(1, Math.ceil(type.length / 8))),
        type.length);
    case Type.byteList:
      return Buffer.alloc(0);
    case Type.byteVector:
      return Buffer.alloc(type.length);
    case Type.list:
      return [];
    case Type.vector:
      return Array.from({length: type.length}, () =>
        defaultValue(type.elementType));
    case Type.container:
      // eslint-disable-next-line no-case-declarations
      const obj = {} as any;
      type.fields.forEach(([fieldName, fieldType]) =>
        obj[fieldName] = defaultValue(fieldType));
      return obj;
  }
}
