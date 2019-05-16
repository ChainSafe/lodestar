/** @module ssz */
import assert from "assert";

import {
  AnySSZType,
  FullSSZType,
  SimpleContainerType,
  SimpleVectorType,
  Type,
} from "../types";

// regex to identify a bytes type
const bytesPattern = /^bytes\d*$/;
// regex to identify digits
const digitsPattern = /\d+$/;
// regex to identify a uint type
const uintPattern = /^(uint|number)\d+$/;
// regex to identify a number type specifically
const numberPattern = /^number/;

export function copyType(type: AnySSZType): AnySSZType {
  return JSON.parse(JSON.stringify(type));
}

export function parseType(type: AnySSZType): FullSSZType {
  if(typeof type === "string") {
    if (type === "bool") {
      return {
        type: Type.bool,
      };
    }
    if (type.match(bytesPattern)) {
      const length = parseInt(type.match(digitsPattern) as unknown as string);
      if (isNaN(length)) {
        return {
          type: Type.byteList,
        };
      } else {
        return {
          type: Type.byteVector,
          length,
        };
      }
    }
    if (type.match(uintPattern)) {
      const useNumber = Array.isArray(type.match(numberPattern));
      const bits = parseInt(type.match(digitsPattern) as unknown as string);
      assert([8, 16, 32, 64, 128, 256].find((b) => b === bits), `Invalid uint type: ${type}`);
      return {
        type: Type.uint,
        byteLength: bits / 8,
        offset: 0,
        useNumber,
      };
    }
    if (type === "byte") {
      return {
        type: Type.uint,
        byteLength: 1,
        offset: 0,
        useNumber: true,
      };
    }
  } if (Array.isArray(type)) {
    if (type.length === 1) {
      const elementType = parseType(type[0]);
      if (elementType.type === Type.uint && elementType.byteLength === 1) {
        return {
          type: Type.byteList,
        };
      } else {
        return {
          type: Type.list,
          elementType,
        };
      }
    } else if (type.length === 2) {
      const elementType = parseType(type[0]);
      const length = (type as SimpleVectorType)[1] as number;
      assert(Number.isInteger(length), "Vector length must be an integer")
      if (elementType.type === Type.uint && elementType.byteLength === 1) {
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
    }
    assert.fail("Array length must be 1 or 2");
  } else if (type === Object(type)) {
    if (isFullSSZType(type)) {
      return type as FullSSZType;
    } else {
      type = type as SimpleContainerType;
      assert(typeof type.name === "string", "Container must have a name");
      assert(Array.isArray(type.fields), "Container must have fields specified as an array");
      return {
        type: Type.container,
        name: type.name,
        fields: type.fields.map(([fieldName, fieldType]: [string, any]) => {
          assert(typeof fieldName === "string", "Container field name must be a string");
          return [fieldName, parseType(fieldType)];
        }) as [string, FullSSZType][],
      }
    }
  }
  throw new Error(`Invalid type: ${type}`);
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
    Type.byteList,
    Type.byteVector,
    Type.list,
    Type.vector,
    Type.container,
  ].includes(type.type);
}

// A "variable-size" type is a list and all types that contain a variable-size type.
// All other types are said to be "fixed-size"
export function isVariableSizeType(type: FullSSZType): boolean {
  switch (type.type) {
    case Type.bool:
    case Type.uint:
    case Type.byteVector:
      return false;
    case Type.byteList:
    case Type.list:
      return true;
    case Type.vector:
      return isVariableSizeType(type.elementType);
    case Type.container:
      return type.fields.some(([_, fieldType]) => isVariableSizeType(fieldType));
  }
}
