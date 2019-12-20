/* eslint-disable @typescript-eslint/no-explicit-any */
import {AnySSZType, FullSSZType, Type, parseType, UintImpl} from "@chainsafe/ssz-type-schema";
import {BitList, BitVector} from "@chainsafe/bit-utils";
import BN from "bn.js";

export function fromYaml<T>(type: AnySSZType, value: any): T {
  return _expandYamlValue(parseType(type), value);
}

function _expandYamlValue(type: FullSSZType, value: any): any {
  switch(type.type) {
    case Type.uint:
      switch (type.use) {
        case UintImpl.bn:
          return new BN(value);
        case UintImpl.bigint:
          return BigInt(value);
        case UintImpl.number:
          return Number.isSafeInteger(Number(value)) ? Number(value) : Infinity;
      }
      break;
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
      return value.map((element: any) => _expandYamlValue(type.elementType, element));
    case Type.container:
      type.fields.forEach(([fieldName, fieldType]) => {
        value[fieldName] = _expandYamlValue(fieldType, value[fieldName]);
      });
      return value;
  }
}
