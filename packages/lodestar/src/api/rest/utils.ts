import snakeCase from "snake-case";
import {toHex} from "../../util/bytes";
import BN from "bn.js";

export function toRestJson(o: object): object {
  o = {...o};
  for(let key in o) {
    if(o.hasOwnProperty(key)) {
      if(Buffer.isBuffer(o[key])) {
        o[snakeCase(key)] = toHex(o[key]);
        delete o[key];
        continue;
      }
      if(BN.isBN(o[key])) {
        o[snakeCase(key)] = o[key].toString();
        delete o[key];
        continue;
      }
      if(typeof o[key]  === 'object') {
        o[snakeCase(key)] = toRestJson(o[key]);
        delete o[key];
        continue;
      }
      o[snakeCase(key)] = o[key];
      delete o[key];
    }
  }
  return o;
}