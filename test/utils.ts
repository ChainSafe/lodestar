import {
  SerializableType,
} from "../src/types";

export function stringifyType (type: SerializableType): string {
  if (typeof type === 'string') {
    return type;
  } else if (Array.isArray(type)) {
    if (type.length === 1) {
      return `[${stringifyType(type[0])}]`;
    } else if (type.length === 2) {
      return `[${stringifyType(type[0])}, ${type[1]}]`;
    }
  } else if (type === Object(type)) {
    return type.name;
  }
  return "";
}
