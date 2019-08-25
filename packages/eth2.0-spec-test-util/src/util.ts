import camelcase from "camelcase";
import {lstatSync, readdirSync} from "fs";

export function objectToCamelCase(obj: object): object {
  if (Object(obj) === obj) {
    Object.getOwnPropertyNames(obj).forEach((name) => {
      const newName = camelcase(name);
      if (newName !== name) {
        obj[newName] = obj[name];
        delete obj[name];
      }
      objectToCamelCase(obj[newName]);
    });
  } else if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      obj[i] = objectToCamelCase(obj[i]);
    }
  }
  return obj;
}

export function isDirectory(path: string): boolean {
  return lstatSync(path).isDirectory();
}