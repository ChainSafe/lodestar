/* eslint-disable @typescript-eslint/no-explicit-any */
import {AnySSZType, FullSSZType, Type, parseType, UintImpl} from "@chainsafe/ssz-type-schema";
import {BitList, BitVector} from "@chainsafe/bit-utils";
import BN from "bn.js";

export function fromYaml<T>(value: any, type: AnySSZType): T {
  return _expandYamlValue(value, parseType(type));
}

function _expandYamlValue(value: any, type: FullSSZType): any {
  switch(type.type) {
    case Type.uint:
      switch (type.use) {
        case UintImpl.bn:
          return new BN(value);
        case UintImpl.bigint:
          return BigInt(value);
        case UintImpl.number:
          const n = Number(value);
          return Number.isSafeInteger(n) ? n : Infinity;
      }
    case Type.bool:
      return value;
    case Type.bitList:
      return BitList.deserialize(Buffer.from(value.slice(2), "hex"));
    case Type.bitVector:
      return BitVector.fromBitfield(Buffer.from(value.slice(2), "hex"), type.length);
    case Type.byteList:
    case Type.byteVector:
      return Buffer.from(value.slice(2), "hex");
    case Type.list:
    case Type.vector:
      return value.map((element: any) => _expandYamlValue(element, type.elementType));
    case Type.container:
      type.fields.forEach(([fieldName, fieldType]) => {
        value[fieldName] = _expandYamlValue(value[fieldName], fieldType);
      });
      return value;
  }
}
