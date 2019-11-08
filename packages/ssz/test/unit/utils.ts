import {SimpleSSZType,} from "@chainsafe/ssz-type-schema";
// @ts-ignore
BigInt.prototype.toJSON = function() { return this.toString(); };
export function stringifyType (type: SimpleSSZType): string {
  if (typeof type === "string") {
    return type;
  } else if (Array.isArray(type)) {
    if (type.length === 1) {
      return `[${stringifyType(type[0] as SimpleSSZType)}]`;
    } else if (type.length === 2) {
      return `[${stringifyType(type[0] as SimpleSSZType)}, ${type[1]}]`;
    }
  } else if (type === Object(type)) {
    return JSON.stringify(type);
  }
  return "";
}
