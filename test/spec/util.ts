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
  return type
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

export function eq(type: any, obj1: any, obj2: any): boolean {
  const _type = parseType(type);
  return _eq(_type, obj1, obj2);
}

function _eq(type: FullSSZType, obj1: any, obj2: any): boolean {
  switch (type.type) {
    case Type.uint:
      return obj1.toString(16) === obj2.toString(16);
    case Type.bool:
      return obj1 === obj2;
    case Type.byteList:
    case Type.byteVector:
      return obj1.toString('hex') === obj2.toString('hex');
    case Type.list:
    case Type.vector:
      return obj1.length === obj2.length &&
        obj1.every((e1: any, i: number) => _eq(type.elementType, e1, obj2[i]));
    case Type.container:
      return type.fields.every(([fieldName, fieldType]) => _eq(fieldType, obj1[fieldName], obj2[fieldName]));
  }
}
