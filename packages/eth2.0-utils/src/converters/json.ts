/* eslint-disable @typescript-eslint/no-explicit-any */

import snakeCase from "snake-case";
import {toHex} from "../bytes";
import {AnySSZType, FullSSZType, parseType, Type} from "@chainsafe/ssz-type-schema";
import {BitList, BitVector} from "@chainsafe/bit-utils";
import {objectToCamelCase} from "../misc";

export function toJson(o: object): object {
  o = {...o};
  for (const key in o) {
    const newKey = snakeCase(key);
    //@ts-ignore
    o[newKey] = o[key] !== null ? serializeToJson(o[key]) : null;
    if (newKey !== key) {
      //@ts-ignore
      delete o[key];
    }
  }
  return o;
}

function serializeToJson(value: any): any {
  if (Buffer.isBuffer(value)) {
    return toHex(value);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (BitVector.isBitVector(value)) {
    return Buffer.from((value as BitVector).toBitfield()).toString("hex");
  }
  if (BitList.isBitList(value)) {
    return Buffer.from((value as BitList).serialize()).toString("hex");
  }
  if (Array.isArray(value)) {
    return value.map(toJson);
  }
  if (typeof value === "object") {
    return toJson(value);
  }
  return value;
}

export function fromJson<T>(value: object, type: AnySSZType): T {
  value = objectToCamelCase({...value});
  return expandJsonValue(value, parseType(type));
}


function expandJsonValue(value: any, type: FullSSZType): any {
  switch (type.type) {
    case Type.uint:
      if (type.byteLength <= 6 || type.useNumber) {
        const n = Number(value);
        return Number.isSafeInteger(n) ? n : Infinity;
      } else {
        return BigInt(value);
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
      return value.map((element: any) => expandJsonValue(element, type.elementType));
    case Type.container:
      type.fields.forEach(([fieldName, fieldType]) => {
        value[fieldName] = expandJsonValue(value[fieldName], parseType(fieldType));
      });
      return value;
  }
}
