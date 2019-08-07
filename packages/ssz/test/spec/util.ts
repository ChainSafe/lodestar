import {BitList, BitVector} from "@chainsafe/bit-utils";
// eslint-disable-next-line import/no-extraneous-dependencies
import camelCase from "camelcase";
import {
  FullSSZType,
  parseType,
  Type,
} from "../../src";

// remove all 'number' uint types, yaml spec tests convert all numbers to BN
export function hydrateType(type: any): FullSSZType {
  return _hydrateType(parseType(type));
}

function _hydrateType(type: FullSSZType) {
  switch (type.type) {
    case Type.uint:
      type.useNumber = false;
      break;
    case Type.list:
    case Type.vector:
      type.elementType = _hydrateType(type.elementType);
      break;
    case Type.container:
      type.fields = type.fields.map(([fieldName, fieldType]): [string, FullSSZType] => ([fieldName, _hydrateType(fieldType)]));
      break;
  }
  return type;
}

export function hydrateValue(obj: any, type: any): any {
  return _hydrateValue(obj, parseType(type));
}

function _hydrateValue(obj: any, type: FullSSZType): any {
  switch (type.type) {
    case Type.uint:
      return obj;
    case Type.bool:
      return obj;
    case Type.bitList:
      return BitList.deserialize(Buffer.from(obj.slice(2), 'hex'));
    case Type.bitVector:
      return BitVector.fromBitfield(Buffer.from(obj.slice(2), 'hex'), type.length);
    case Type.byteList:
    case Type.byteVector:
      return Buffer.from(obj.slice(2), 'hex');
    case Type.list:
    case Type.vector:
      return obj.map((element: any) => hydrateValue(element, type.elementType));
    case Type.container:
      type.fields.forEach(([fieldName, fieldType]) => {
        obj[fieldName] = hydrateValue(obj[fieldName], fieldType);
      });
      return obj;
  }
}

export function getTestType(o: any): string {
  return camelCase(Object.keys(o)[0], {pascalCase: true});
}

export function getTestValue(o: any, value: string) {
  return Object.values(o)[0][value];
}
