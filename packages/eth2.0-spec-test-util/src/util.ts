import {lstatSync, readFileSync} from "fs";
import camelcase from "camelcase";
import {load, dump} from "js-yaml";

import {schema} from "./yaml/schema";

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

export function loadYaml(yaml: string): any {
  return objectToCamelCase(
    load(yaml, {schema})
  );
}

export function loadYamlFile(path: string): any {
  return loadYaml(readFileSync(path, "utf8"));
}

export function dumpYaml(yaml: any): string {
  return dump(yaml, {schema});
}

export function isDirectory(path: string): boolean {
  return lstatSync(path).isDirectory();
}
