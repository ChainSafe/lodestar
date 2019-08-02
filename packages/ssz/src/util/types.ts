/** @module ssz */
import assert from "assert";

import {
  AnySSZType,
  FullSSZType,
  SimpleContainerType,
  SimpleListType,
  SimpleVectorType,
  Type,
} from "../types";

// regex to identify a bytesN type
const bytesPattern = /^bytes\d+$/;
// regex to identify digits
const digitsPattern = /\d+$/;
// regex to identify a uint type
const uintPattern = /^(uint|number)\d+$/;
// regex to identify a number type specifically
const numberPattern = /^number/;

export function copyType(type: AnySSZType): AnySSZType {
  return JSON.parse(JSON.stringify(type));
}

/**
 * Recursively expand an [[AnySSZType]] into a [[FullSSZType]]
 */
export function parseType(type: AnySSZType): FullSSZType {
  if (isFullSSZType(type)) {
    return type as FullSSZType;
  }
  if(typeof type === 'string') {
    // bit
    if (type === 'bool') {
      return {
        type: Type.bool,
      };
    }
    // bytesN
    if (type.match(bytesPattern)) {
      const length = parseInt(type.match(digitsPattern) as unknown as string);
      return {
        type: Type.byteVector,
        length,
      };
    }
    // uint
    if (type === 'byte') {
      return {
        type: Type.uint,
        byteLength: 1,
        useNumber: true,
      };
    }
    // uint
    if (type.match(uintPattern)) {
      const useNumber = Array.isArray(type.match(numberPattern));
      const bits = parseInt(type.match(digitsPattern) as unknown as string);
      assert([8, 16, 32, 64, 128, 256].find((b) => b === bits), `Invalid uint type: ${type}`);
      return {
        type: Type.uint,
        byteLength: bits / 8,
        useNumber,
      };
    }
  } else if (type === Object(type)) {
    if (Number.isSafeInteger((type as SimpleListType).maxLength)) {
      type = type as SimpleListType;
      const elementType = parseType(type.elementType);
      const maxLength = type.maxLength;
      if (elementType.type === Type.bool) {
        return {
          type: Type.bitList,
          maxLength,
        };
      } else if (elementType.type === Type.uint && elementType.byteLength === 1) {
        return {
          type: Type.byteList,
          maxLength,
        };
      } else {
        return {
          type: Type.list,
          elementType,
          maxLength,
        };
      }
    } else if (Number.isSafeInteger((type as SimpleVectorType).length)) {
      type = type as SimpleVectorType;
      const elementType = parseType(type.elementType);
      const length = type.length;
      if (elementType.type === Type.bool) {
        return {
          type: Type.bitVector,
          length,
        };
      } else if (elementType.type === Type.uint && elementType.byteLength === 1) {
        return {
          type: Type.byteVector,
          length,
        };
      } else {
        return {
          type: Type.vector,
          elementType,
          length,
        };
      }
    } else if (Array.isArray((type as SimpleContainerType).fields)) {
      type = type as SimpleContainerType;
      return {
        type: Type.container,
        fields: type.fields.map(([fieldName, fieldType]: [string, any]) => {
          assert(typeof fieldName === "string", "Container field name must be a string");
          return [fieldName, parseType(fieldType)];
        }) as [string, FullSSZType][],
      };
    }
  }
  throw new Error(`Invalid type: ${JSON.stringify(type)}`);
}

export function isFullSSZType(type: AnySSZType): boolean {
  return type === Object(type) && Object.values(Type).includes((type as any).type);
}

export function isBasicType(type: FullSSZType): boolean {
  return [
    Type.uint,
    Type.bool,
  ].includes(type.type);
}

export function isCompositeType(type: FullSSZType): boolean {
  return [
    Type.bitList,
    Type.bitVector,
    Type.byteList,
    Type.byteVector,
    Type.list,
    Type.vector,
    Type.container,
  ].includes(type.type);
}

/**
 * A variable-size type is a list and all types that contain a variable-size type.
 *
 * All other types are said to be fixed-size
 */
export function isVariableSizeType(type: FullSSZType): boolean {
  switch (type.type) {
    case Type.bool:
    case Type.uint:
    case Type.bitVector:
    case Type.byteVector:
      return false;
    case Type.bitList:
    case Type.byteList:
    case Type.list:
      return true;
    case Type.vector:
      return isVariableSizeType(type.elementType);
    case Type.container:
      return type.fields.some(([_, fieldType]) => isVariableSizeType(fieldType));
  }
}
