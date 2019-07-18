import {AnySSZType, FullSSZType, Type, parseType} from "@chainsafe/ssz";

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
