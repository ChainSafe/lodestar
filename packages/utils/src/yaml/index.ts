import yaml from "js-yaml";
import {schema} from "./schema.js";

const {load, dump} = yaml;

export function loadYaml<T = Record<string, unknown>>(yaml: string): T {
  return load(yaml, {schema}) as T;
}

export function dumpYaml(yaml: unknown): string {
  return dump(yaml, {schema});
}
