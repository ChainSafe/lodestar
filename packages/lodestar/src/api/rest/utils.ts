import snakeCase from "snake-case";
import {toHex} from "../../util/bytes";
import BN from "bn.js";
import {AnySSZType, FullSSZType, parseType, Type} from "@chainsafe/ssz";
import camelcaseKeys from "camelcase-keys";
import {BitList, BitVector} from "@chainsafe/bit-utils";

export function toRestJson(o: object): object {
  o = {...o};
  for(let key in o) {
    const newKey = snakeCase(key);
    o[newKey] =  o[key] !== null ? serializeToRestValue(o[key]): null;
    if(newKey !== key) {
      delete o[key];
    }
  }
  return o;
}

export function serializeToRestValue(value: any): any {
  if(Buffer.isBuffer(value)) {
    return toHex(value);
  }
  if (BN.isBN(value)) {
    return  value.toString();
  }
  if(BitVector.isBitVector(value)) {
    return  Buffer.from((value as BitVector).toBitfield()).toString('hex');
  }
  if(BitList.isBitList(value)) {
    return  Buffer.from((value as BitList).serialize()).toString('hex');
  }
  if(Array.isArray(value)) {
    return value.map(toRestJson);
  }
  if (typeof value  === 'object') {
    return toRestJson(value);
  }
  return value;
}

export function fromRestJson<T>(value: object, type: AnySSZType): T {
  value = camelcaseKeys(value, {deep: true});
  return expandJsonValue(value, parseType(type));
}


function expandJsonValue(value: any, type: FullSSZType): any {
  switch(type.type) {
    case Type.uint:
      if (type.byteLength > 6 && type.useNumber)
        return Infinity;
      return type.useNumber ? new BN(value).toNumber() : new BN(value);
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
      return value.map((element) => expandJsonValue(element, type.elementType));
    case Type.container:
      type.fields.forEach(([fieldName, fieldType]) => {
        value[fieldName] = expandJsonValue(value[fieldName], fieldType);
      });
      return value;
  }
}