import snakeCase from "snake-case";
import {toHex} from "../../util/bytes";
import BN from "bn.js";
import {AnySSZType, FullSSZType, parseType, Type} from "@chainsafe/ssz";
import camelcaseKeys from "camelcase-keys";
import {BitList, BitVector} from "@chainsafe/bit-utils";

export function toRestJson(o: object): object {
  o = {...o};
  for(let key in o) {
    if(o.hasOwnProperty(key)) {
      if(Buffer.isBuffer(o[key])) {
        o[snakeCase(key)] = toHex(o[key]);
      } else if (BN.isBN(o[key])) {
        o[snakeCase(key)] = o[key].toString();
      } else if(BitVector.isBitVector(o[key])) {
        o[snakeCase(key)] = Buffer.from((o[key] as BitVector).toBitfield()).toString('hex');
      } else if(BitList.isBitList(o[key])) {
        o[snakeCase(key)] = Buffer.from((o[key] as BitList).serialize()).toString('hex');
      } else if(Array.isArray(o[key])) {
        o[snakeCase(key)] = o[key].map(toRestJson);
      } else if (typeof o[key]  === 'object' && o[key] != null) {
        o[snakeCase(key)] = toRestJson(o[key]);
      } else {
        o[snakeCase(key)] = o[key];
      }
      if(snakeCase(key) !== key) {
        delete o[key];
      }
    }
  }
  return o;
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