import {load, dump} from "js-yaml";
import {schema} from "./schema";

export function loadYaml<T = Record<string, unknown>>(yaml: string): T {
  return load(yaml, {schema}) as T;
}

export function dumpYaml(yaml: unknown): string {
  return dump(yaml, {schema});
}
