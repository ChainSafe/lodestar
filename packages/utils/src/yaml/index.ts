import {load, dump} from "js-yaml";
import {schema} from "./schema.js";
import {objectToExpectedCase} from "../objects.js";

export function loadYaml(yaml: string): Record<string, unknown> {
  return objectToExpectedCase<Record<string, unknown>>(load(yaml, {schema}));
}

export function dumpYaml(yaml: unknown): string {
  return dump(yaml, {schema});
}
