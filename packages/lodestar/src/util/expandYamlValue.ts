import {AnySSZType, FullSSZType, Type, parseType} from "@chainsafe/ssz";
import {BitList, BitVector} from "@chainsafe/bit-utils";
import decamelize from "decamelize"; 

export function expandYamlValue(value: any, type: AnySSZType): any {
  return _expandYamlValue(value, parseType(type));
}

function _expandYamlValue(value: any, type: FullSSZType): any {
  switch(type.type) {
    case Type.uint:
      if (type.byteLength > 6 && type.useNumber && value.toArrayLike(Buffer, type.byteLength).equals(Buffer.alloc(type.byteLength, 255)))
        return Infinity;
      return type.useNumber ? value.toNumber() : value;
    case Type.bool:
      return value;
    case Type.bitList:
      return BitList.deserialize(Buffer.from(value.slice(2), 'hex'));
    case Type.bitVector:
      return BitVector.fromBitfield(Buffer.from(value.slice(2), 'hex'), type.length);
    case Type.byteList:
    case Type.byteVector:
      return Buffer.from(value.slice(2), 'hex');
    case Type.list:
    case Type.vector:
      return value.map((element) => _expandYamlValue(element, type.elementType));
    case Type.container:
      type.fields.forEach(([fieldName, fieldType]) => {
        value[fieldName] = _expandYamlValue(value[fieldName], fieldType);
      });
      return value;
  }
}

export function unexpandInput(input: any, type: FullSSZType, intToStr: boolean): any {
  switch (type.type) {
      case Type.uint:
          if (intToStr) {
              return input.toString(10);
          } else {
              return input;
          }
      case Type.bool:
          return Boolean(input);
      case Type.bitList:
          return "0x" + input.serialize().toString('hex');
      case Type.bitVector:
          return "0x" + input.toBitfield().toString('hex');
      case Type.byteList:
      case Type.byteVector:
          return "0x" + input.toString('hex');
      case Type.list:
      case Type.vector:
          return input.map((i: any) => unexpandInput(i, type.elementType, intToStr));
      case Type.container:
          const output: any = {};
          type.fields.forEach(([fieldName, fieldType]) => {
              output[fieldName] = unexpandInput(input[fieldName] || input[decamelize(fieldName)], fieldType, intToStr);
          });
          return output;
  }
}